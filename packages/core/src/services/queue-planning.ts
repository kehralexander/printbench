import { loadedFilament, namesFilament, type WantedFilament } from './loaded-filament'
import type { FilamentSlot } from './printer-status'

/**
 * Looking ahead in the queue: what an idle printer should print next, and
 * whether the spools last for everything queued on them.
 *
 * Both are plain functions over what the page has already loaded — the
 * queue in its order, the worker's printer snapshots and Spoolman's spools —
 * so they cost no extra reads and are easy to test.
 */

export interface PlannedRequest {
  id: string
  title: string
  /** Every filament it prints in; empty for "any". */
  filaments: WantedFilament[]
  /**
   * Waiting on its requester — a quote not yet accepted, a deposit not yet
   * paid — so it is not offered as next up.
   */
  held?: boolean
}

export interface IdlePrinter {
  id: string
  name: string
  /** What the printer reports loaded; empty when it does not say. */
  slots: FilamentSlot[]
}

export interface LoadNextHint {
  printerId: string
  printerName: string
  /** The first request in queue order the printer can start as it is. */
  ready: { request: PlannedRequest; slot: FilamentSlot | null } | null
  /**
   * The most urgent request, when it is not the ready one because its
   * filaments are not loaded: what to swap in for it.
   */
  swap: { request: PlannedRequest; filament: string } | null
}

/**
 * For each idle printer: the next request it could start without touching
 * the filament, and — when that is not the head of the queue — what to load
 * to print the head of the queue instead.
 *
 * A request that names no filament can go on any printer. A printer that
 * reports no slots cannot be checked, so the head of the queue is simply
 * what is next.
 */
export function loadNextHints(printers: IdlePrinter[], queue: PlannedRequest[]): LoadNextHint[] {
  const ready = queue.filter((request) => !request.held)
  if (ready.length === 0) return []
  return printers.map((printer) => {
    const head = ready[0]!
    if (printer.slots.length === 0) {
      return {
        printerId: printer.id,
        printerName: printer.name,
        ready: { request: head, slot: null },
        swap: null,
      }
    }
    const here = [{ printerName: printer.name, slots: printer.slots }]
    let next: LoadNextHint['ready'] = null
    let headMissing: WantedFilament[] = []
    for (const request of ready) {
      const verdict = loadedFilament(request.filaments, here)
      if (verdict === null) {
        next = { request, slot: null }
        break
      }
      if (verdict.loaded) {
        next = { request, slot: verdict.slot }
        break
      }
      if (request.id === head.id) headMissing = verdict.missing
    }
    const swap =
      next?.request.id === head.id
        ? null
        : {
            request: head,
            filament: describeFilaments(headMissing.length > 0 ? headMissing : head.filaments),
          }
    return { printerId: printer.id, printerName: printer.name, ready: next, swap }
  })
}

/** "spool #21", or "PETG #ff0000" — what someone would go and fetch. */
export function describeFilament(wanted: WantedFilament): string {
  if (wanted.spoolmanSpoolId != null) {
    return [`spool #${wanted.spoolmanSpoolId}`, wanted.material].filter(Boolean).join(' · ')
  }
  return (
    [wanted.material, wanted.colorName || wanted.colorHex].filter(Boolean).join(' ') ||
    'its filament'
  )
}

/** Several filaments, "PLA #ff0000 and PETG #0000ff". */
export function describeFilaments(wanted: readonly WantedFilament[]): string {
  const named = wanted.filter(namesFilament)
  if (named.length === 0) return 'its filament'
  const parts = named.map(describeFilament)
  return parts.length === 1
    ? parts[0]!
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export interface ForecastRequest {
  id: string
  title: string
  status: 'requested' | 'printing'
  /** Each filament's spool and its grams for one print. */
  filaments: { spoolmanSpoolId: number | null; grams: number | null }[]
  /** Prints still to do, the running one included. */
  left: number
  /** How far the running print is, 0–1, when one is. */
  progress: number | null
}

export interface SpoolForecast {
  spoolId: number
  remainingG: number
  /** Grams the open queue needs from this spool. */
  neededG: number
  /** Prints queued on the spool. */
  prints: number
  /** Prints the spool covers before it runs out; null when it lasts. */
  runsOutAfter: number | null
  /** Requests the spool will not stretch to, in queue order. */
  shortRequestIds: string[]
}

/**
 * Walks the open queue in order, print by print, taking each filament's
 * grams from its spool, and says where each spool runs dry.
 *
 * What is on the printer goes first and counts only what it has still to
 * use. Filaments without grams cannot be counted and are passed over; a spool
 * Spoolman does not know (or that reports no weight) is left out.
 */
export function spoolForecast(
  queue: ForecastRequest[],
  remaining: Map<number, number | null>,
): SpoolForecast[] {
  const ordered = [
    ...queue.filter((request) => request.status === 'printing'),
    ...queue.filter((request) => request.status === 'requested'),
  ]
  const spools = new Map<number, SpoolForecast & { usedG: number }>()

  for (const request of ordered) {
    // Two tools on the same spool draw from it together.
    const perSpool = new Map<number, number>()
    for (const filament of request.filaments) {
      if (filament.spoolmanSpoolId == null || filament.grams == null) continue
      perSpool.set(
        filament.spoolmanSpoolId,
        (perSpool.get(filament.spoolmanSpoolId) ?? 0) + filament.grams,
      )
    }
    for (const [spoolId, gramsEach] of perSpool) {
      const remainingG = remaining.get(spoolId)
      if (remainingG == null) continue
      let spool = spools.get(spoolId)
      if (!spool) {
        spool = {
          spoolId,
          remainingG,
          neededG: 0,
          prints: 0,
          runsOutAfter: null,
          shortRequestIds: [],
          usedG: 0,
        }
        spools.set(spoolId, spool)
      }
      for (let copy = 0; copy < Math.max(1, request.left); copy++) {
        const grams =
          copy === 0 && request.status === 'printing' && request.progress != null
            ? gramsEach * (1 - Math.min(Math.max(request.progress, 0), 1))
            : gramsEach
        spool.usedG += grams
        spool.neededG += grams
        spool.prints += 1
        if (spool.usedG > spool.remainingG) {
          spool.runsOutAfter ??= spool.prints - 1
          if (!spool.shortRequestIds.includes(request.id)) spool.shortRequestIds.push(request.id)
        }
      }
    }
  }

  return [...spools.values()].map(({ usedG: _used, ...spool }) => ({
    ...spool,
    neededG: Math.ceil(spool.neededG),
  }))
}
