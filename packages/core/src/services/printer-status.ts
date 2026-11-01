import { isValidEndpoint, type PrintHostConfig } from './print-hosts'

/**
 * What a networked printer is doing right now: idle or busy, and if busy, how
 * far along and how long is left.
 *
 * Read-only and best effort. Each protocol reports a different subset, so
 * every field past `state` is optional and the page shows what it gets.
 *
 *   moonraker  GET /printer/objects/query?print_stats&display_status&…&mmu
 *   octoprint  GET /api/job
 *   prusalink  GET /api/v1/status (+ /api/v1/job for the file name)
 */

export type PrinterState =
  'idle' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error' | 'offline'

export interface PrinterStatus {
  state: PrinterState
  /** True while a job occupies the printer: printing or paused. */
  busy: boolean
  /** The file being (or last) printed, as the printer names it. */
  filename?: string
  /** 0–1. */
  progress?: number
  /** Seconds spent printing so far. */
  elapsedSec?: number
  /** Seconds left, as the printer reports it or extrapolated from progress. */
  remainingSec?: number
  /** Whether `remainingSec` came from the printer or from extrapolation. */
  remainingSource?: 'printer' | 'extrapolated'
  layer?: number
  totalLayers?: number
  nozzle?: Temperature
  bed?: Temperature
  /** What the printer says alongside an error, or why it could not be read. */
  message?: string
  /**
   * Filament loaded in a multi-material unit, in slot order — an Anycubic ACE
   * through KX-Bridge, or a Happy Hare MMU. Absent when there is none.
   */
  slots?: FilamentSlot[]
}

export interface FilamentSlot {
  /** 0-based, in the unit's own order. */
  index: number
  loaded: boolean
  material?: string
  /** #rrggbb */
  colorHex?: string
  /** The filament profile name the unit reports, when it has one. */
  name?: string
  /** The Spoolman spool bound to the slot, when the bridge tracks that. */
  spoolmanSpoolId?: number
  /** The slot currently feeding the nozzle. */
  active: boolean
}

export interface Temperature {
  actual: number
  target: number
}

/** A status page polls; a printer that takes longer than this is shown offline. */
const STATUS_TIMEOUT_MS = 5_000

/**
 * Extrapolating from progress is noise in the first minutes — 1% done after
 * ninety seconds of homing and bed levelling says nothing about the rest.
 */
const MIN_PROGRESS_TO_EXTRAPOLATE = 0.02

export async function readPrinterStatus(
  host: PrintHostConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<PrinterStatus> {
  if (!isValidEndpoint(host.endpoint)) {
    return offline('Endpoint must be an http or https URL.')
  }

  const base = host.endpoint.replace(/\/+$/, '')
  const headers: Record<string, string> = { accept: 'application/json' }
  if (host.apiKey) headers['x-api-key'] = host.apiKey

  const get = async (path: string): Promise<Record<string, unknown>> => {
    const response = await fetchImpl(`${base}${path}`, {
      headers,
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (response.status === 401 || response.status === 403) {
      throw new StatusError('The printer rejected the API key.')
    }
    if (!response.ok) throw new StatusError(`Printer replied ${response.status}.`)
    return asRecord(await response.json())
  }

  try {
    switch (host.protocol) {
      case 'moonraker':
      case 'kx-bridge':
        return moonrakerStatus(
          asRecord(
            asRecord(
              (
                await get(
                  '/printer/objects/query?webhooks&print_stats&display_status&virtual_sdcard&extruder&heater_bed&mmu',
                )
              ).result,
            ).status,
          ),
        )
      case 'octoprint':
        return octoprintStatus(await get('/api/job'))
      case 'prusalink': {
        const status = await get('/api/v1/status')
        const job = asRecord(status.job)
        // The file name is only on the job resource, which 204s when idle.
        const detail = job.id != null ? await get('/api/v1/job').catch(() => ({})) : {}
        return prusalinkStatus(status, detail)
      }
    }
  } catch (error) {
    if (error instanceof StatusError) return offline(error.message)
    if (error instanceof Error && error.name === 'TimeoutError') {
      return offline('The printer did not answer in time.')
    }
    return offline('Could not reach the printer.')
  }
}

class StatusError extends Error {}

function offline(message: string): PrinterStatus {
  return { state: 'offline', busy: false, message }
}

/**
 * Klipper through Moonraker — and KX-Bridge, which speaks the same objects for
 * an Anycubic Kobra X and adds `print_stats.remain_time` from the printer's own
 * countdown, which beats any extrapolation.
 */
export function moonrakerStatus(objects: Record<string, unknown>): PrinterStatus {
  const webhooks = asRecord(objects.webhooks)
  const stats = asRecord(objects.print_stats)
  const display = asRecord(objects.display_status)
  const sdcard = asRecord(objects.virtual_sdcard)
  const info = asRecord(stats.info)

  // Klipper itself not ready (shutdown, firmware restart) trumps the job state.
  const klippy = text(webhooks.state)
  if (klippy === 'shutdown' || klippy === 'error') {
    return { state: 'error', busy: false, message: text(webhooks.state_message) }
  }
  if (klippy === 'startup') {
    return { state: 'offline', busy: false, message: 'Klipper is starting.' }
  }

  const state = moonrakerState(text(stats.state))
  const progress = fraction(number(display.progress) ?? number(sdcard.progress))
  const elapsedSec = number(stats.print_duration)
  return withTiming({
    state,
    busy: state === 'printing' || state === 'paused',
    filename: text(stats.filename),
    progress,
    elapsedSec,
    reportedRemainingSec: number(stats.remain_time),
    layer: number(info.current_layer),
    totalLayers: number(info.total_layer),
    nozzle: temperature(objects.extruder),
    bed: temperature(objects.heater_bed),
    slots: mmuSlots(objects.mmu),
    message: state === 'error' ? text(stats.message) : undefined,
  })
}

function moonrakerState(value: string | undefined): PrinterState {
  switch (value) {
    case 'printing':
      return 'printing'
    case 'paused':
      return 'paused'
    case 'complete':
      return 'complete'
    case 'cancelled':
      return 'cancelled'
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}

export function octoprintStatus(job: Record<string, unknown>): PrinterStatus {
  const raw = (text(job.state) ?? '').toLowerCase()
  const progressInfo = asRecord(job.progress)
  const file = asRecord(asRecord(job.job).file)

  const state: PrinterState = raw.startsWith('offline')
    ? 'offline'
    : raw.includes('error')
      ? 'error'
      : raw.startsWith('pausing') || raw.startsWith('paused')
        ? 'paused'
        : raw.startsWith('printing') || raw.startsWith('resuming') || raw.startsWith('starting')
          ? 'printing'
          : raw.startsWith('cancelling')
            ? 'cancelled'
            : 'idle'

  const completion = number(progressInfo.completion)
  return withTiming({
    state,
    busy: state === 'printing' || state === 'paused',
    filename: text(file.display) ?? text(file.name),
    progress: completion == null ? undefined : fraction(completion / 100),
    elapsedSec: number(progressInfo.printTime),
    reportedRemainingSec: number(progressInfo.printTimeLeft),
    message:
      state === 'error' || state === 'offline' ? (text(job.error) ?? text(job.state)) : undefined,
  })
}

export function prusalinkStatus(
  status: Record<string, unknown>,
  jobDetail: Record<string, unknown>,
): PrinterStatus {
  const printer = asRecord(status.printer)
  const job = asRecord(status.job)
  const file = asRecord(jobDetail.file)

  const state: PrinterState = (() => {
    switch (text(printer.state)?.toUpperCase()) {
      case 'PRINTING':
        return 'printing'
      case 'PAUSED':
        return 'paused'
      case 'FINISHED':
        return 'complete'
      case 'STOPPED':
        return 'cancelled'
      case 'ERROR':
      case 'ATTENTION':
        return 'error'
      default:
        return 'idle'
    }
  })()

  const progress = number(job.progress)
  return withTiming({
    state,
    busy: state === 'printing' || state === 'paused',
    filename: text(file.display_name) ?? text(file.name),
    progress: progress == null ? undefined : fraction(progress / 100),
    elapsedSec: number(job.time_printing),
    reportedRemainingSec: number(job.time_remaining),
    nozzle: pair(printer.temp_nozzle, printer.target_nozzle),
    bed: pair(printer.temp_bed, printer.target_bed),
  })
}

/**
 * Settles the time left: the printer's own figure when it gives a positive
 * one, otherwise elapsed ÷ progress − elapsed once there is enough progress for
 * that to mean something. Nothing for a printer that is not busy.
 */
function withTiming(
  input: Omit<PrinterStatus, 'remainingSec' | 'remainingSource'> & {
    reportedRemainingSec?: number
  },
): PrinterStatus {
  const { reportedRemainingSec, ...status } = input
  const clean = Object.fromEntries(
    Object.entries(status).filter(([, value]) => value !== undefined),
  ) as unknown as PrinterStatus

  if (!status.busy) return clean
  if (reportedRemainingSec != null && reportedRemainingSec > 0) {
    return { ...clean, remainingSec: Math.round(reportedRemainingSec), remainingSource: 'printer' }
  }
  const { progress, elapsedSec } = status
  if (
    progress != null &&
    elapsedSec != null &&
    progress >= MIN_PROGRESS_TO_EXTRAPOLATE &&
    progress < 1
  ) {
    return {
      ...clean,
      remainingSec: Math.round(elapsedSec / progress - elapsedSec),
      remainingSource: 'extrapolated',
    }
  }
  return clean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function fraction(value: number | undefined): number | undefined {
  return value == null ? undefined : Math.min(1, Math.max(0, value))
}

/**
 * Happy Hare's `mmu` object: parallel arrays, one entry per gate. KX-Bridge
 * emulates it for the ACE, including `gate_spool_id` from its Spoolman plugin
 * (-1 for none).
 */
export function mmuSlots(value: unknown): FilamentSlot[] | undefined {
  const mmu = asRecord(value)
  const statuses = Array.isArray(mmu.gate_status) ? mmu.gate_status : null
  if (!statuses || statuses.length === 0) return undefined
  const at = (key: string, index: number): unknown => {
    const list = mmu[key]
    return Array.isArray(list) ? list[index] : undefined
  }
  const active = number(mmu.gate)
  return statuses.map((status, index) => {
    // Happy Hare: -1 unknown, 0 empty, 1 available, 2 available from buffer.
    const loaded = typeof status === 'number' && status > 0
    const color = text(at('gate_color', index))?.replace(/^#/, '')
    const spoolId = number(at('gate_spool_id', index))
    const slot: FilamentSlot = { index, loaded, active: active === index }
    if (!loaded) return slot
    const material = text(at('gate_material', index))
    const name = text(at('gate_filament_name', index))
    if (material) slot.material = material
    if (color && /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) {
      slot.colorHex = `#${color.slice(0, 6).toLowerCase()}`
    }
    if (name) slot.name = name
    if (spoolId != null && spoolId > 0) slot.spoolmanSpoolId = spoolId
    return slot
  })
}

function temperature(value: unknown): Temperature | undefined {
  const heater = asRecord(value)
  return pair(heater.temperature, heater.target)
}

function pair(actual: unknown, target: unknown): Temperature | undefined {
  const a = number(actual)
  return a == null ? undefined : { actual: a, target: number(target) ?? 0 }
}
