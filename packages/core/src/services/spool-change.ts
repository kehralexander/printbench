import { setSpoolmanLocation, type SpoolmanSpool } from '../spoolman/spoolman'
import { readKxSlots } from './kx-bridge'
import {
  listKxProfiles,
  printerMaterial,
  profileForSpool,
  readKxSpoolMap,
  setKxSlot,
  setKxSlotProfile,
  writeKxSpoolMap,
} from './kx-bridge-spools'
import { materialFamily } from './loaded-filament'
import type { PrintHostConfig } from './print-hosts'
import { readPrinterStatus, type PrinterStatus } from './printer-status'

/**
 * Putting a Spoolman spool into a KX-Bridge slot, everywhere at once: the
 * printer's screen (material and colour), the bridge's slicer profile and
 * spool binding, and the spool's location in Spoolman — in for the new one,
 * back to the shelf for the one coming out.
 *
 * Four systems with no transaction between them. Every step is safe to
 * repeat, so a failed one is fixed by running the change again rather than
 * by undoing the ones that worked; the result says which did what.
 */

export interface SpoolChange {
  /** 0-based, as the bridge numbers slots. */
  slotIndex: number
  /** The spool going in; null leaves the slot without one. */
  spool: SpoolmanSpool | null
  /** Where the spool coming out is kept from now on. */
  returnLocation: string
}

export type StepKey = 'printer' | 'profile' | 'binding' | 'spool-in' | 'spool-out' | 'confirm'

export interface StepOutcome {
  key: StepKey
  /** "Printer shows PLA Matte #2d3f6f". */
  label: string
  /** `unconfirmed`: sent, but the printer has not shown it took it. */
  status: 'done' | 'skipped' | 'failed' | 'unconfirmed'
  detail?: string
}

export type SpoolChangeResult =
  | {
      ok: boolean
      steps: StepOutcome[]
      /** The spool the bridge had on the slot before. */
      previousSpoolId: number | null
      /** The slot the new spool was bound to before, now cleared. */
      movedFromSlot: number | null
    }
  | { ok: false; refused: string }

export interface SpoolChangeDeps {
  fetch?: typeof fetch
  readStatus?: (host: PrintHostConfig) => Promise<PrinterStatus>
  /** What the spool coming out is called in Spoolman, to look up where it is. */
  spools?: readonly SpoolmanSpool[]
  sleep?: (ms: number) => Promise<void>
}

/** Time for the printer to answer setInfo with a report of its own. */
const CONFIRM_AFTER_MS = 2_500

/** Refused before anything is written: why it cannot happen now. */
export function refuseSpoolChange(
  status: PrinterStatus,
  host: PrintHostConfig,
  spool: SpoolmanSpool | null,
): string | null {
  if (host.protocol !== 'kx-bridge') return `${host.name} is not a KX-Bridge printer.`
  if (status.state === 'offline') return status.message ?? `${host.name} is offline.`
  // Rebinding resets the bridge's usage counters: a print's usage would be lost.
  if (status.busy) return `${host.name} is printing. Change spools when it is done.`
  if (spool?.archived) return `Spool #${spool.id} is archived in Spoolman.`
  return null
}

export async function changeSpool(
  host: PrintHostConfig,
  change: SpoolChange,
  deps: SpoolChangeDeps = {},
): Promise<SpoolChangeResult> {
  const fetchImpl = deps.fetch ?? fetch
  const status = await (deps.readStatus ?? ((h) => readPrinterStatus(h, fetchImpl)))(host)
  const refused = refuseSpoolChange(status, host, change.spool)
  if (refused) return { ok: false, refused }

  const { slotIndex, spool } = change
  const steps: StepOutcome[] = []
  const material = spool ? printerMaterial(spool) : null
  const colorHex = spool?.colorHex ?? null

  // 1. The printer: what its screen says, and what a print start checks against.
  if (!spool) {
    steps.push({
      key: 'printer',
      label: 'Printer slot',
      status: 'skipped',
      detail: 'The printer notices an empty slot itself.',
    })
  } else if (!material || !colorHex) {
    steps.push({
      key: 'printer',
      label: 'Printer slot',
      status: 'skipped',
      detail: `Spool #${spool.id} has no ${material ? 'colour' : 'material'} in Spoolman.`,
    })
  } else {
    const sent = await setKxSlot(host, slotIndex, material, colorHex, fetchImpl)
    steps.push({
      key: 'printer',
      label: `Printer shows ${material} ${colorHex}`,
      status: sent.ok ? 'done' : 'failed',
      ...(sent.ok ? {} : { detail: sent.error }),
    })
  }

  // 2. The slicer profile: the spool's, or none rather than the last spool's.
  const profile =
    spool?.material != null
      ? profileForSpool(
          spool,
          await listKxProfiles(host, materialFamily(spool.material), fetchImpl),
        )
      : null
  const profiled = await setKxSlotProfile(host, slotIndex, profile, fetchImpl)
  steps.push({
    key: 'profile',
    label: profile ? `Slicer profile ${profile.name}` : 'Slicer profile cleared',
    status: profiled.ok ? 'done' : 'failed',
    ...(profiled.ok ? {} : { detail: profiled.error }),
  })

  // 3. The binding the bridge books usage against. The whole map goes back.
  let previousSpoolId: number | null = null
  let movedFromSlot: number | null = null
  let stillBound = new Set<number>()
  const read = await readKxSpoolMap(host, fetchImpl)
  if (!read.ok) {
    steps.push({ key: 'binding', label: 'Spool binding', status: 'failed', detail: read.error })
  } else {
    const map = new Map(read.map)
    previousSpoolId = map.get(slotIndex) ?? null
    if (spool) {
      for (const [other, bound] of map) {
        if (bound === spool.id && other !== slotIndex) {
          movedFromSlot = other
          map.delete(other)
        }
      }
      map.set(slotIndex, spool.id)
    } else {
      map.delete(slotIndex)
    }
    const unchanged = sameBindings(map, read.map)
    const written = unchanged
      ? { ok: true as const, map }
      : await writeKxSpoolMap(host, read.route, map, fetchImpl)
    stillBound = new Set(written.ok ? written.map.values() : read.map.values())
    steps.push({
      key: 'binding',
      label: spool
        ? `Slot ${slotIndex + 1} bound to spool #${spool.id}` +
          (movedFromSlot != null ? `, slot ${movedFromSlot + 1} unbound` : '')
        : `Slot ${slotIndex + 1} unbound`,
      status: written.ok ? 'done' : 'failed',
      ...(written.ok ? {} : { detail: written.error }),
    })
  }

  // 4. Spoolman: the new spool is in this printer now…
  if (spool) {
    if (spool.location === host.name) {
      steps.push({ key: 'spool-in', label: `Spool #${spool.id} in ${host.name}`, status: 'done' })
    } else {
      const moved = await setSpoolmanLocation(spool.id, host.name, { fetch: fetchImpl })
      steps.push({
        key: 'spool-in',
        label: `Spool #${spool.id} moved to ${host.name}`,
        status: moved.ok ? 'done' : 'failed',
        ...(moved.ok ? {} : { detail: moved.error }),
      })
    }
  }

  // …and the one it replaces is back where it is kept, unless still in use here.
  if (
    previousSpoolId != null &&
    previousSpoolId !== spool?.id &&
    !stillBound.has(previousSpoolId)
  ) {
    const known = deps.spools?.find((s) => s.id === previousSpoolId)
    if (known && known.location === change.returnLocation) {
      steps.push({
        key: 'spool-out',
        label: `Spool #${previousSpoolId} in ${change.returnLocation}`,
        status: 'done',
      })
    } else {
      const moved = await setSpoolmanLocation(previousSpoolId, change.returnLocation, {
        fetch: fetchImpl,
      })
      steps.push({
        key: 'spool-out',
        label: `Spool #${previousSpoolId} moved to ${change.returnLocation}`,
        status: moved.ok ? 'done' : 'failed',
        ...(moved.ok ? {} : { detail: moved.error }),
      })
    }
  }

  // 5. The bridge answers set_slot before the printer does; a refusal only
  //    shows as the old colour coming back. Look once the printer has spoken.
  const printerStep = steps.find((step) => step.key === 'printer')
  if (printerStep?.status === 'done' && material && colorHex) {
    await (deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
      CONFIRM_AFTER_MS,
    )
    const slots = await readKxSlots(host, fetchImpl).catch(() => null)
    const now = slots?.find((slot) => slot.index === slotIndex)
    const shows =
      now?.colorHex?.toLowerCase() === colorHex.toLowerCase() &&
      (!now.material || materialFamily(now.material) === materialFamily(material))
    steps.push({
      key: 'confirm',
      label: shows ? 'Printer confirmed' : 'Printer has not confirmed',
      status: shows ? 'done' : 'unconfirmed',
      ...(shows
        ? {}
        : {
            detail: now?.colorHex
              ? `Slot ${slotIndex + 1} still shows ${now.colorHex}. Check the printer's screen.`
              : `Could not read slot ${slotIndex + 1} back.`,
          }),
    })
  }

  return {
    ok: steps.every((step) => step.status !== 'failed'),
    steps,
    previousSpoolId,
    movedFromSlot,
  }
}

function sameBindings(a: Map<number, number>, b: Map<number, number>): boolean {
  return a.size === b.size && [...a].every(([slot, spool]) => b.get(slot) === spool)
}
