import { describe, expect, it, vi } from 'vitest'
import type { PrintHostConfig } from './print-hosts'
import {
  moonrakerStatus,
  octoprintStatus,
  prusalinkStatus,
  readPrinterStatus,
} from './printer-status'

/** What KX-Bridge answers mid-print, trimmed to the objects that are read. */
const kxPrinting = {
  webhooks: { state: 'ready', state_message: 'Printer is ready' },
  print_stats: {
    state: 'printing',
    filename: 'benchy_PLA_0.2.gcode',
    print_duration: 1800,
    total_duration: 1800,
    remain_time: 4200,
    info: { current_layer: 42, total_layer: 120 },
  },
  display_status: { progress: 0.31, message: '' },
  virtual_sdcard: { progress: 0.31, is_active: true },
  extruder: { temperature: 219.6, target: 220, power: 0 },
  heater_bed: { temperature: 59.9, target: 60, power: 0 },
}

const kobra: PrintHostConfig = {
  id: 'h1',
  name: 'Kobra X',
  protocol: 'moonraker',
  endpoint: 'http://kx-bridge:7125/',
}

describe('moonraker / KX-Bridge', () => {
  it('reads a print in progress with the printer’s own time left', () => {
    expect(moonrakerStatus(kxPrinting)).toEqual({
      state: 'printing',
      busy: true,
      filename: 'benchy_PLA_0.2.gcode',
      progress: 0.31,
      elapsedSec: 1800,
      remainingSec: 4200,
      remainingSource: 'printer',
      layer: 42,
      totalLayers: 120,
      nozzle: { actual: 219.6, target: 220 },
      bed: { actual: 59.9, target: 60 },
    })
  })

  it('extrapolates time left when the printer gives none, as plain Klipper does', () => {
    const { remain_time: _, ...stats } = kxPrinting.print_stats
    const status = moonrakerStatus({
      ...kxPrinting,
      print_stats: stats,
      display_status: { progress: 0.25 },
    })
    expect(status.remainingSec).toBe(5400)
    expect(status.remainingSource).toBe('extrapolated')
  })

  it('does not guess from the first percent of a print', () => {
    const status = moonrakerStatus({
      ...kxPrinting,
      print_stats: { ...kxPrinting.print_stats, remain_time: 0, print_duration: 90 },
      display_status: { progress: 0.01 },
    })
    expect(status.remainingSec).toBeUndefined()
  })

  it('reports idle without timing, even with a stale countdown', () => {
    const status = moonrakerStatus({
      ...kxPrinting,
      print_stats: { ...kxPrinting.print_stats, state: 'standby', filename: '' },
      display_status: { progress: 0 },
    })
    expect(status).toMatchObject({ state: 'idle', busy: false })
    expect(status.remainingSec).toBeUndefined()
    expect(status.filename).toBeUndefined()
  })

  it('treats paused as busy', () => {
    const status = moonrakerStatus({
      ...kxPrinting,
      print_stats: { ...kxPrinting.print_stats, state: 'paused' },
    })
    expect(status).toMatchObject({ state: 'paused', busy: true, remainingSec: 4200 })
  })

  it('reports a Klipper shutdown as an error with its message', () => {
    expect(
      moonrakerStatus({
        ...kxPrinting,
        webhooks: { state: 'shutdown', state_message: 'MCU lost communication' },
      }),
    ).toEqual({ state: 'error', busy: false, message: 'MCU lost communication' })
  })

  it('queries the objects it reads, under the configured endpoint', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { eventtime: 1, status: kxPrinting } }), {
          status: 200,
        }),
    ) as unknown as typeof fetch
    const status = await readPrinterStatus(kobra, fetchImpl)
    expect(status.state).toBe('printing')
    const url = String(vi.mocked(fetchImpl).mock.calls[0]![0])
    expect(url.startsWith('http://kx-bridge:7125/printer/objects/query?')).toBe(true)
    expect(url).toContain('print_stats')
    expect(url).toContain('display_status')
  })
})

describe('reaching the printer', () => {
  it('shows a printer that cannot be reached as offline, not as an exception', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await readPrinterStatus(kobra, fetchImpl)).toEqual({
      state: 'offline',
      busy: false,
      message: 'Could not reach the printer.',
    })
  })

  it('says so when the API key is wrong', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 401 }),
    ) as unknown as typeof fetch
    expect((await readPrinterStatus(kobra, fetchImpl)).message).toBe(
      'The printer rejected the API key.',
    )
  })

  it('refuses a non-http endpoint without fetching', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const status = await readPrinterStatus({ ...kobra, endpoint: 'file:///etc' }, fetchImpl)
    expect(status.state).toBe('offline')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('octoprint', () => {
  it('reads a job in progress', () => {
    expect(
      octoprintStatus({
        state: 'Printing',
        job: { file: { name: 'part.gcode', display: 'part.gcode' } },
        progress: { completion: 50, printTime: 600, printTimeLeft: 620 },
      }),
    ).toEqual({
      state: 'printing',
      busy: true,
      filename: 'part.gcode',
      progress: 0.5,
      elapsedSec: 600,
      remainingSec: 620,
      remainingSource: 'printer',
    })
  })

  it('reads an idle printer', () => {
    expect(
      octoprintStatus({ state: 'Operational', job: { file: {} }, progress: { completion: null } }),
    ).toEqual({ state: 'idle', busy: false })
  })
})

describe('prusalink', () => {
  it('reads a job in progress with temperatures and the file name', () => {
    expect(
      prusalinkStatus(
        {
          printer: {
            state: 'PRINTING',
            temp_nozzle: 215,
            target_nozzle: 215,
            temp_bed: 60,
            target_bed: 60,
          },
          job: { id: 12, progress: 80, time_printing: 3200, time_remaining: 800 },
        },
        { file: { name: 'PART~1.BGC', display_name: 'part.bgcode' } },
      ),
    ).toMatchObject({
      state: 'printing',
      filename: 'part.bgcode',
      progress: 0.8,
      remainingSec: 800,
      nozzle: { actual: 215, target: 215 },
    })
  })
})
