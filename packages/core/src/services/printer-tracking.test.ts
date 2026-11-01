import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb } from '@pb/db'
import type { PrinterStatus } from './printer-status'
import { outcomeOf, printerSnapshots, trackPrinter } from './printer-tracking'
import {
  createRequest,
  getRequest,
  listRequests,
  queueStats,
  setRequestStatus,
} from './request-service'

/**
 * The printer watch: statuses in, print history and queue progress out.
 *
 * Driven tick by tick with explicit clocks, the way the worker drives it, so
 * every transition — start, progress, finish, cancel, swap, offline — is
 * checked against what lands in the database.
 */

const LIB = '7dab1000-0000-4000-8000-000000000001'
const MODEL = '7dab1000-0000-4000-8000-000000000002'
const HOST = '7dab1000-0000-4000-8000-000000000003'
const printer = { id: HOST, name: 'Kobra X' }

// A day ago, whole minutes: the manual paths stamp the real clock.
const T0 = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 86_400_000)
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

const printing = (
  filename: string,
  progress: number,
  elapsedMin: number,
  remainingMin?: number,
): PrinterStatus => ({
  state: 'printing',
  busy: true,
  filename,
  progress,
  elapsedSec: elapsedMin * 60,
  ...(remainingMin != null ? { remainingSec: remainingMin * 60, remainingSource: 'printer' } : {}),
})
const idle: PrinterStatus = { state: 'idle', busy: false }
const complete = (filename: string, elapsedMin: number): PrinterStatus => ({
  state: 'complete',
  busy: false,
  filename,
  progress: 1,
  elapsedSec: elapsedMin * 60,
})

describe('printer tracking', { tags: ['integration'] }, () => {
  let pool: ReturnType<typeof createDb>['pool']
  let db: ReturnType<typeof createDb>['db']
  let root = ''
  let plateId = ''

  beforeAll(async () => {
    ;({ pool, db } = createDb())
    await cleanup()
    root = await mkdtemp(path.join(tmpdir(), 'pb-tracking-'))
    await mkdir(path.join(root, 'Benchy'))
    const gcode = 'G28\n; total filament used [g] = 12.3\n'
    await writeFile(path.join(root, 'Benchy', 'benchy_plate.gcode'), gcode)
    await db.execute(sql`
      INSERT INTO libraries (id, name, kind, backend, path)
      VALUES (${LIB}, 'Tracking', 'managed', 'local', ${root})`)
    await db.execute(sql`
      INSERT INTO models (id, library_id, path, name, slug, public_id)
      VALUES (${MODEL}, ${LIB}, 'Benchy', 'Benchy', 'benchy', 'trk-benchy')`)
    plateId = (
      await db.execute<{ id: string }>(sql`
        INSERT INTO model_files (model_id, filename, extension, category, size)
        VALUES (${MODEL}, 'benchy_plate.gcode', 'gcode', 'slicer', ${gcode.length})
        RETURNING id`)
    ).rows[0]!.id
  })

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM print_requests`)
    await db.execute(sql`DELETE FROM print_runs WHERE model_id = ${MODEL}`)
    await db.execute(sql`DELETE FROM print_hosts WHERE id = ${HOST}`)
    await db.execute(sql`
      INSERT INTO print_hosts (id, name, protocol, endpoint)
      VALUES (${HOST}, 'Kobra X', 'moonraker', 'http://kx-bridge:7125')`)
  })

  afterAll(async () => {
    await cleanup()
    if (root) await rm(root, { recursive: true, force: true })
    await pool.end()
  })

  async function cleanup() {
    await db.execute(sql`DELETE FROM print_requests`)
    await db.execute(sql`DELETE FROM print_runs WHERE model_id = ${MODEL}`)
    await db.execute(sql`DELETE FROM print_hosts WHERE id = ${HOST}`)
    await db.execute(sql`DELETE FROM libraries WHERE id = ${LIB}`)
  }

  const runs = async () =>
    (
      await db.execute<{
        status: string
        printer_name: string | null
        duration_min: number | null
        started_at: Date | null
        filament_used_g: string | null
        notes: string | null
        model_file_id: string | null
      }>(sql`
        SELECT status, printer_name, duration_min, started_at, filament_used_g, notes, model_file_id
        FROM print_runs WHERE model_id = ${MODEL} ORDER BY finished_at`)
    ).rows

  const jobs = async () =>
    (
      await db.execute<{
        status: string
        filename: string
        request_id: string | null
        finished_at: Date | null
      }>(
        sql`SELECT status, filename, request_id, finished_at FROM printer_jobs WHERE host_id = ${HOST} ORDER BY started_at`,
      )
    ).rows

  const request = (quantity = 1, estimatedMin = 60) =>
    createRequest(
      db,
      {
        title: 'Benchy for Sam',
        requestedBy: 'Sam',
        modelId: MODEL,
        modelFileId: plateId,
        quantity,
        estimatedMin,
        material: 'PLA',
      },
      null,
    )

  it('puts a waiting request on the printer when its file starts, from the printer’s start time', async () => {
    const { id } = await request()
    await trackPrinter(db, printer, printing('/data/gcodes/benchy_plate.gcode', 0.1, 10), at(10))

    const after = await getRequest(db, id)
    expect(after?.status).toBe('printing')
    expect(after?.startedAt?.toISOString()).toBe(T0.toISOString())
    expect(await jobs()).toMatchObject([{ status: 'printing', request_id: id, finished_at: null }])
  })

  it('logs a finished print with the printer’s times and closes a single request', async () => {
    const { id } = await request()
    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.1, 10), at(10))
    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.6, 50), at(50))
    await trackPrinter(db, printer, complete('benchy_plate.gcode', 83), at(84))
    // Later ticks of the same finished state change nothing.
    await trackPrinter(db, printer, complete('benchy_plate.gcode', 83), at(85))
    await trackPrinter(db, printer, idle, at(90))

    const logged = await runs()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      status: 'success',
      printer_name: 'Kobra X',
      duration_min: 83,
      model_file_id: plateId,
      notes: 'Printed on Kobra X, for Sam.',
    })
    expect(Number(logged[0]!.filament_used_g)).toBe(13)
    const after = await getRequest(db, id)
    expect(after).toMatchObject({ status: 'done', printsDone: 1 })
    expect(after?.printRunId).not.toBeNull()
    expect(after?.closedAt).not.toBeNull()
  })

  it('counts prints towards the quantity and keeps the request waiting in between', async () => {
    const { id } = await request(2)
    // Recent clocks: only a recent printer reading counts as live.
    const now = (minutes: number) => new Date(Date.now() + minutes * 60_000)
    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.5, 30, 30), now(30))
    // Live: 30 min left of this print plus one more 60 min print.
    expect((await queueStats(db)).remainingMin).toBe(90)

    await trackPrinter(db, printer, complete('benchy_plate.gcode', 60), now(61))
    let after = await getRequest(db, id)
    expect(after).toMatchObject({ status: 'requested', printsDone: 1, startedAt: null })
    expect((await queueStats(db)).remainingMin).toBe(60)

    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.2, 12), now(80))
    expect((await getRequest(db, id))?.status).toBe('printing')
    await trackPrinter(db, printer, complete('benchy_plate.gcode', 60), now(130))
    after = await getRequest(db, id)
    expect(after).toMatchObject({ status: 'done', printsDone: 2 })
    expect(await runs()).toHaveLength(2)
  })

  it('treats a printer going idle part-way as a cancel: logged as failed, request back in line', async () => {
    const { id } = await request()
    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.4, 30), at(30))
    // KX-Bridge reports a cancel as plain standby.
    await trackPrinter(db, printer, idle, at(31))

    expect(await runs()).toMatchObject([
      { status: 'failed', notes: 'Cancelled on Kobra X at 40%, for Sam.', filament_used_g: null },
    ])
    expect(await getRequest(db, id)).toMatchObject({ status: 'requested', printsDone: 0 })
    expect(await jobs()).toMatchObject([{ status: 'cancelled' }])
  })

  it('leaves a job open while the printer is unreachable', async () => {
    await request()
    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.4, 30), at(30))
    await trackPrinter(db, printer, { state: 'offline', busy: false, message: 'gone' }, at(31))
    expect(await jobs()).toMatchObject([{ status: 'printing', finished_at: null }])
    expect(await runs()).toHaveLength(0)
  })

  it('prefers a request already marked printing — Start or Send & start — over a waiting one', async () => {
    const waiting = await request()
    const started = await request()
    await setRequestStatus(db, started.id, 'printing')
    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.05, 2), at(2))

    expect((await getRequest(db, started.id))?.status).toBe('printing')
    expect((await getRequest(db, waiting.id))?.status).toBe('requested')
    expect(await jobs()).toMatchObject([{ request_id: started.id }])
  })

  it('gives a request marked printed by hand mid-print the printer’s times, not a second entry', async () => {
    const { id } = await request()
    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.5, 40), at(40))
    await setRequestStatus(db, id, 'done')
    await trackPrinter(db, printer, complete('benchy_plate.gcode', 80), at(81))

    const logged = await runs()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({ duration_min: 80, printer_name: 'Kobra X' })
  })

  it('records a file that is not in the library without logging or touching the queue', async () => {
    const { id } = await request()
    await trackPrinter(db, printer, printing('calibration_cube.gcode', 0.5, 5), at(5))
    await trackPrinter(db, printer, complete('calibration_cube.gcode', 10), at(11))
    expect(await jobs()).toMatchObject([{ status: 'success', request_id: null }])
    expect(await runs()).toHaveLength(0)
    expect((await getRequest(db, id))?.status).toBe('requested')
  })

  it('ends the old job when the printer moves straight on to another file', async () => {
    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.99, 59), at(59))
    await trackPrinter(db, printer, printing('other.gcode', 0.01, 1), at(62))
    expect((await jobs()).map((job) => job.status)).toEqual(['success', 'printing'])
  })

  it('shows the live printer on the request and keeps the last reading', async () => {
    const { id } = await request()
    await trackPrinter(db, printer, printing('benchy_plate.gcode', 0.25, 20, 60))
    const [row] = (await listRequests(db, { status: ['printing'] })).filter((r) => r.id === id)
    expect(row?.live).toEqual({ printerName: 'Kobra X', progress: 0.25, remainingMin: 60 })
    const [snapshot] = (await printerSnapshots(db)).filter((p) => p.id === HOST)
    expect(snapshot).toMatchObject({ fresh: true, status: { state: 'printing', progress: 0.25 } })
  })

  it('judges a silent end by progress', () => {
    expect(outcomeOf({ progress: '0.99' }, idle)).toBe('success')
    expect(outcomeOf({ progress: 0.5 }, idle)).toBe('cancelled')
    expect(outcomeOf({ progress: 0.5 }, { state: 'error', busy: false })).toBe('failed')
  })
})
