import { colourDistance, materialFamily, type WantedFilament } from './loaded-filament'
import {
  UPLOAD_TIMEOUT_MS,
  baseUrl,
  canSendToPrinter,
  describeHttpError,
  describeNetworkError,
  isValidEndpoint,
  uploadMultipart,
  type PrintHostConfig,
  type SendResult,
} from './print-hosts'
import type { FilamentSlot } from './printer-status'

/**
 * Starting a print through KX-Bridge on a chosen ACE slot.
 *
 * Uploaded with print=true, the bridge maps G-code tool N to slot N, and when
 * that slot is empty or holds another material it stops and asks in its own
 * web page — which nobody at PrintBench is looking at. So the file goes up
 * without starting, and the start names the slot for every tool the G-code
 * uses:
 *
 *   POST /server/files/upload   print=false
 *   POST /printer/print/start   { filename, filament_assignments }
 *
 * The bridge starts the last file uploaded, so the two go back to back.
 */

/** One filament the G-code was sliced with, as the bridge reads it. */
export interface GcodePaint {
  /** The tool number, T0 = 0. */
  paint: number
  /** #rrggbb */
  colorHex: string
  material: string
  /** Whether the G-code actually changes to it. */
  used: boolean
}

/** Where one tool of the G-code prints from. */
export interface SlotAssignment {
  paint: number
  slot: number
}

export interface SlotPlan {
  paints: (GcodePaint & {
    /** The best guess; null when nothing loaded will do. */
    slot: number | null
    /** True when the guess needs no one to look at it. */
    sure: boolean
  })[]
  /** Every paint is placed without doubt, so it can start as it is. */
  sure: boolean
}

/** Slots this close in colour are the same filament as far as anyone cares. */
const INTERCHANGEABLE_DISTANCE = 30
/** Same as loaded-filament's: "Matte Navy" is "Navy Blue". */
const SAME_COLOUR_DISTANCE = 80
/** The bridge reads this much of each end of the file for its metadata. */
const HEADER_BYTES = 131_072

/**
 * The filaments a G-code names, read the way KX-Bridge reads them
 * (gcode_meta._extract_filament_info), so tool numbers line up with the ones
 * it maps: colours from `filament_colour`, materials from `filament_type`,
 * and in use when the body has a `T<n>` for it — or, failing that, the
 * header's `; filament: 1,3` list.
 */
export function gcodePaints(data: Uint8Array): GcodePaint[] {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const head = decoder.decode(data.subarray(0, HEADER_BYTES))
  const tail = data.length > HEADER_BYTES ? decoder.decode(data.subarray(-HEADER_BYTES)) : ''

  let colours: string[] = []
  let materials: string[] = []
  let countHint = 0
  let toolOrder: number[] = []
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
    }
  }

  let total = Math.max(colours.length, materials.length, countHint)
  if (toolOrder.length > 0) total = Math.max(total, ...toolOrder)
  if (total <= 0) return []

  // Tool changes in the body: the whole file, as the bridge scans it.
  const used = new Set<number>()
  const body = decoder.decode(data)
  for (const match of body.matchAll(/^[ \t]*T(\d+)\b/gm)) used.add(Number(match[1]))
  // Orca and Prusa number the header list from 1.
  const fromHeader = new Set(toolOrder.map((n) => Math.max(0, n - 1)))

  return Array.from({ length: total }, (_, paint) => ({
    paint,
    colorHex: `#${(colours[paint] || 'FFFFFF').slice(0, 6).toLowerCase()}`,
    material: materials[paint] ?? 'PLA',
    used: used.size > 0 ? used.has(paint) : fromHeader.size > 0 ? fromHeader.has(paint) : true,
  }))
}

function list(value: string, separator: RegExp): string[] {
  return value
    .split(separator)
    .map((part) => part.trim().replace(/^["']+|["']+$/g, ''))
    .filter(Boolean)
}

/**
 * The slots as the bridge numbers them for a print start.
 *
 * `/kx/filament/slots` carries the bridge's own slot numbers; the Spoolman
 * spool on each comes from the Happy Hare `mmu` object, whose gates are the
 * same slots in the same order.
 */
export async function readKxSlots(
  host: PrintHostConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<FilamentSlot[]> {
  const base = baseUrl(host.endpoint)
  const headers: Record<string, string> = { accept: 'application/json' }
  if (host.apiKey) headers['x-api-key'] = host.apiKey
  const get = async (path: string) => {
    const response = await fetchImpl(`${base}${path}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(await describeHttpError(response))
    return (await response.json()) as Record<string, unknown>
  }

  const [listing, objects] = await Promise.all([
    get('/kx/filament/slots'),
    get('/printer/objects/query?mmu').catch(() => ({})),
  ])
  const raw = Array.isArray(listing.result) ? (listing.result as Record<string, unknown>[]) : []
  const mmu = ((objects as { result?: { status?: { mmu?: Record<string, unknown> } } }).result
    ?.status?.mmu ?? {}) as Record<string, unknown>
  const spools = Array.isArray(mmu.gate_spool_id) ? (mmu.gate_spool_id as unknown[]) : []

  return raw
    .filter((slot) => typeof slot.slot_index === 'number')
    .sort((a, b) => (a.slot_index as number) - (b.slot_index as number))
    .map((slot, position) => {
      const loaded = slot.status === 'loaded'
      const out: FilamentSlot = { index: slot.slot_index as number, loaded, active: false }
      if (!loaded) return out
      if (typeof slot.material === 'string' && slot.material) out.material = slot.material
      if (typeof slot.color_hex === 'string' && /^#[0-9a-f]{6}$/i.test(slot.color_hex)) {
        out.colorHex = slot.color_hex.toLowerCase()
      }
      if (typeof slot.filament_name === 'string' && slot.filament_name) {
        out.name = slot.filament_name
      }
      const spool = spools[position]
      if (typeof spool === 'number' && spool > 0) out.spoolmanSpoolId = spool
      return out
    })
}

/**
 * Which slot each tool the G-code uses should print from.
 *
 * With one tool and a queue request behind it, the request decides: its
 * Spoolman spool if that is loaded, else its material and colour. Otherwise
 * — the model page, or a print with several colours — each tool goes to the
 * slot closest to what it was sliced with.
 *
 * A guess is sure when nothing else could be meant: one slot fits, or the
 * ones that do are the same filament. Several reds of one material are
 * interchangeable; a red and a blue PLA for a tool sliced in white are not.
 */
export function planSlots(
  paints: GcodePaint[],
  slots: FilamentSlot[],
  wanted: WantedFilament | null = null,
): SlotPlan {
  const loaded = slots.filter((slot) => slot.loaded)
  const usedPaints = paints.filter((paint) => paint.used)
  // A G-code without the header says nothing; treat it as one tool.
  const toPlace = usedPaints.length > 0 ? usedPaints : [unknownPaint()]
  const taken = new Set<number>()

  const placed = toPlace.map((paint) => {
    const free = loaded.filter((slot) => !taken.has(slot.index))
    let choice: { slot: number | null; sure: boolean }
    if (toPlace.length === 1 && wanted && hasWish(wanted)) {
      choice = forRequest(wanted, free, paint)
    } else {
      const { slot, sure } = closest({ material: paint.material, colorHex: paint.colorHex }, free)
      choice = { slot, sure }
    }
    if (choice.slot != null) taken.add(choice.slot)
    return { ...paint, ...choice }
  })

  return {
    paints: placed,
    sure: loaded.length > 0 && placed.every((paint) => paint.sure && paint.slot != null),
  }
}

function forRequest(
  wanted: WantedFilament,
  slots: FilamentSlot[],
  paint: GcodePaint,
): { slot: number | null; sure: boolean } {
  if (wanted.spoolmanSpoolId != null) {
    const exact = slots.find((slot) => slot.spoolmanSpoolId === wanted.spoolmanSpoolId)
    if (exact) return { slot: exact.index, sure: true }
  }
  if (wanted.material || wanted.colorHex) {
    const choice = closest(wanted, slots)
    if (choice.sure) return { slot: choice.slot, sure: true }
    // Not loaded as asked: offer what the file was sliced for, for a person to confirm.
    const fallback = closest({ material: paint.material, colorHex: paint.colorHex }, slots)
    return { slot: fallback.matched ? fallback.slot : (choice.slot ?? fallback.slot), sure: false }
  }
  return { slot: null, sure: false }
}

function hasWish(wanted: WantedFilament): boolean {
  return wanted.spoolmanSpoolId != null || Boolean(wanted.material) || Boolean(wanted.colorHex)
}

function closest(
  want: { material: string | null; colorHex: string | null },
  slots: FilamentSlot[],
): { slot: number | null; sure: boolean; matched: boolean } {
  if (slots.length === 0) return { slot: null, sure: false, matched: false }
  const family = want.material ? materialFamily(want.material) : null
  const fits = slots.filter(
    (slot) => !family || !slot.material || materialFamily(slot.material) === family,
  )

  if (want.colorHex) {
    const ranked = fits
      .filter((slot) => slot.colorHex)
      .map((slot) => ({ slot, distance: colourDistance(want.colorHex!, slot.colorHex!) }))
      .sort((a, b) => a.distance - b.distance)
    const matching = ranked.filter(({ distance }) => distance <= SAME_COLOUR_DISTANCE)
    if (matching.length > 0) {
      const best = matching[0]!.slot
      return {
        slot: best.index,
        sure: interchangeable(
          best,
          matching.map(({ slot }) => slot),
        ),
        matched: true,
      }
    }
    // Nothing in that colour: the right material at least, for someone to confirm.
    return { slot: (ranked[0]?.slot ?? fits[0] ?? slots[0])!.index, sure: false, matched: false }
  }

  if (fits.length > 0 && family) {
    return { slot: fits[0]!.index, sure: interchangeable(fits[0]!, fits), matched: true }
  }
  // Nothing to go on but what is loaded: sure only when there is one choice.
  return { slot: slots[0]!.index, sure: slots.length === 1, matched: false }
}

/** Every candidate is, to a person, the same spool as the best one. */
function interchangeable(best: FilamentSlot, candidates: FilamentSlot[]): boolean {
  return candidates.every(
    (slot) =>
      slot === best ||
      (best.colorHex != null &&
        slot.colorHex != null &&
        colourDistance(best.colorHex, slot.colorHex) <= INTERCHANGEABLE_DISTANCE &&
        (!best.material ||
          !slot.material ||
          materialFamily(best.material) === materialFamily(slot.material))),
  )
}

function unknownPaint(): GcodePaint {
  return { paint: 0, colorHex: '', material: '', used: true }
}

/**
 * Uploads without starting, then starts with every tool on its slot.
 *
 * Tools the G-code lists but never uses go along marked unused, as the
 * bridge's own dialog sends them; the printer otherwise waits for a colour
 * nobody meant to load.
 */
export async function startOnKxBridge(
  host: PrintHostConfig,
  file: { filename: string; data: Uint8Array<ArrayBuffer> },
  paints: GcodePaint[],
  assignments: SlotAssignment[],
  slots: FilamentSlot[],
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!isValidEndpoint(host.endpoint)) {
    return { ok: false, error: 'Endpoint must be an http or https URL.' }
  }
  if (!canSendToPrinter(file.filename.split('.').pop() ?? '')) {
    return { ok: false, error: 'Only sliced files can be sent to a printer.' }
  }
  if (assignments.length === 0) return { ok: false, error: 'Choose a slot to print from.' }

  const base = baseUrl(host.endpoint)
  const headers: Record<string, string> = {}
  if (host.apiKey) headers['x-api-key'] = host.apiKey
  const bySlot = new Map(slots.map((slot) => [slot.index, slot]))
  const byPaint = new Map(assignments.map((a) => [a.paint, a.slot]))
  const listed = paints.length > 0 ? paints : [unknownPaint()]

  const filamentAssignments = listed.map((paint) => {
    const slotIndex = byPaint.get(paint.paint)
    if (slotIndex == null) return { paint_index: paint.paint, slot_index: -1, is_used: false }
    const slot = bySlot.get(slotIndex)
    return {
      paint_index: paint.paint,
      slot_index: slotIndex,
      is_used: true,
      // What the slicer coloured it, so the printer's screen matches the preview.
      paint_color: rgba(paint.colorHex || slot?.colorHex || '#ffffff'),
      material: slot?.material ?? paint.material ?? 'PLA',
    }
  })

  try {
    const uploaded = await uploadMultipart(
      fetchImpl,
      `${base}/server/files/upload`,
      headers,
      file,
      {
        print: 'false',
      },
    )
    if (!uploaded.ok) return uploaded
    const filename = uploaded.remotePath ?? file.filename

    const response = await fetchImpl(`${base}/printer/print/start`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ filename, filament_assignments: filamentAssignments }),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
    if (response.status === 504) {
      return { ok: false, error: `${host.name} has the file but did not confirm the start.` }
    }
    if (!response.ok) return { ok: false, error: await describeHttpError(response) }
    return { ok: true, remotePath: filename }
  } catch (error) {
    return { ok: false, error: describeNetworkError(error, host.endpoint) }
  }
}

function rgba(hex: string): [number, number, number, number] {
  const clean = hex.replace(/^#/, '').padEnd(6, 'f')
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(clean.slice(at, at + 2), 16))
  return [r ?? 255, g ?? 255, b ?? 255, 255].map((v) => (Number.isNaN(v) ? 255 : v)) as [
    number,
    number,
    number,
    number,
  ]
}

/** "slot 2 (Anycubic PLA)" — for messages. Numbered from 1, as the bridge shows them. */
export function describeSlot(slot: FilamentSlot | undefined, index: number): string {
  const what = slot?.name ?? slot?.material
  return what ? `slot ${index + 1} (${what})` : `slot ${index + 1}`
}
