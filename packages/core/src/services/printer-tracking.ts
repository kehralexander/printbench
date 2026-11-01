import { sql } from 'drizzle-orm'
import type { Database } from '@pb/db'
import { logPrint } from './print-service'
import type { PrinterStatus } from './printer-status'
import { plateFilamentG } from './request-service'

/**
 * Turning printer status into history and queue progress.
 *
 * The worker reads every printer on a short interval and hands each status to
 * `trackPrinter`, which keeps one open `printer_jobs` row per printer:
 *
 *   busy, no open job          → a job starts; a queued request for the same
 *                                file goes on the printer
 *   busy with a different file → the old job ends (it was swapped), a new one starts
 *   not busy, open job         → the job ends: logged in the print history, and
 *                                its request counts a print or goes back to waiting
 *   offline                    → nothing; an unreachable printer has not stopped
 *
 * Every step re-reads the database and is safe to repeat, so a missed or
 * doubled tick costs nothing but a delay.
 */

/** A job that ended this close to 100% finished, whatever the printer said after. */
const DONE_PROGRESS = 0.98

export type JobOutcome = 'success' | 'cancelled' | 'failed'

type OpenJob = {
  id: string
  filename: string
  model_id: string | null
  model_file_id: string | null
  request_id: string | null
  progress: string | null
  print_sec: number | null
  started_at: Date
}

export interface LibraryFile {
  modelId: string
  modelFileId: string
  modelPublicId: string
  modelName: string
  thumbState: string | null
  thumbKey: string | null
}

/**
 * The sliced file in the library a printer's job most likely is, by name.
 *
 * Printers report the name the file was uploaded under, often behind a
 * directory. Several library files can share a name; one an open request is
 * waiting on wins, then the newest.
 */
export async function matchLibraryFile(
  db: Database,
  printerFilename: string,
): Promise<LibraryFile | null> {
  const name = printerFilename.split('/').pop()?.trim().toLowerCase()
  if (!name) return null
  const rows = await db.execute<{
    model_id: string
    file_id: string
    public_id: string
    name: string
    thumb_state: string | null
    thumb_key: string | null
  }>(sql`
    SELECT f.model_id, f.id AS file_id, m.public_id, m.name, f.thumb_state, f.thumb_key
    FROM model_files f
    JOIN models m ON m.id = f.model_id
    WHERE f.missing_at IS NULL AND m.missing_at IS NULL
      AND f.category = 'slicer'
      AND lower(regexp_replace(f.filename, '^.*/', '')) = ${name}
    ORDER BY EXISTS (
               SELECT 1 FROM print_requests r
               WHERE r.model_file_id = f.id AND r.status IN ('requested', 'printing')
             ) DESC,
             f.updated_at DESC
    LIMIT 1`)
  const row = rows.rows[0]
  return row
    ? {
        modelId: row.model_id,
        modelFileId: row.file_id,
        modelPublicId: row.public_id,
        modelName: row.name,
        thumbState: row.thumb_state,
        thumbKey: row.thumb_key,
      }
    : null
}

export async function trackPrinter(
  db: Database,
  host: { id: string; name: string },
  status: PrinterStatus,
  now: Date = new Date(),
): Promise<void> {
  await db.execute(sql`
    UPDATE print_hosts
    SET status = ${JSON.stringify(status)}::jsonb,
        status_at = ${now},
        last_seen_ok = ${status.state === 'offline' ? sql`last_seen_ok` : sql`${now}`}
    WHERE id = ${host.id}`)

  if (status.state === 'offline') return

  const open = (
    await db.execute<OpenJob>(sql`
      SELECT id, filename, model_id, model_file_id, request_id, progress, print_sec, started_at
      FROM printer_jobs
      WHERE host_id = ${host.id} AND finished_at IS NULL
      ORDER BY started_at DESC`)
  ).rows

  // Only ever one, but a crash between two writes must not leave a second stuck open.
  const [current, ...stale] = open
  for (const job of stale) await finishJob(db, host, job, 'cancelled', now, null)

  if (status.busy && status.filename) {
    if (current && current.filename === status.filename) {
      await db.execute(sql`
        UPDATE printer_jobs
        SET progress = ${status.progress ?? null}, print_sec = ${roundOrNull(status.elapsedSec)}
        WHERE id = ${current.id}`)
      // A request raised or linked after the print began can still join it.
      if (!current.request_id && current.model_id) await attachRequest(db, current.id)
      return
    }
    if (current) await finishJob(db, host, current, outcomeOf(current, null), now, null)
    await startJob(db, host, status, now)
    return
  }

  if (current) await finishJob(db, host, current, outcomeOf(current, status), now, status)
}

/**
 * How a job ended. The printer says so when it reports `complete`, `cancelled`
 * or `error`; a printer that just went back to idle — KX-Bridge does this for
 * a cancel — is judged by how far it got.
 */
export function outcomeOf(
  job: { progress: string | number | null },
  status: PrinterStatus | null,
): JobOutcome {
  if (status?.state === 'complete') return 'success'
  if (status?.state === 'cancelled') return 'cancelled'
  if (status?.state === 'error') return 'failed'
  const progress = Math.max(Number(job.progress ?? 0), status?.progress ?? 0)
  return progress >= DONE_PROGRESS ? 'success' : 'cancelled'
}

async function startJob(
  db: Database,
  host: { id: string; name: string },
  status: PrinterStatus,
  now: Date,
): Promise<void> {
  const file = await matchLibraryFile(db, status.filename!)
  // The printer's own clock for when it began, if it says; a worker that
  // started mid-print should not log the print as starting then.
  const startedAt =
    status.elapsedSec != null && status.elapsedSec > 0
      ? new Date(now.getTime() - status.elapsedSec * 1000)
      : now
  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO printer_jobs (host_id, filename, model_id, model_file_id, progress, print_sec, started_at)
    VALUES (${host.id}, ${status.filename!}, ${file?.modelId ?? null}, ${file?.modelFileId ?? null},
            ${status.progress ?? null}, ${roundOrNull(status.elapsedSec)},
            date_trunc('milliseconds', ${startedAt}::timestamptz))
    RETURNING id`)
  if (file) await attachRequest(db, inserted.rows[0]!.id)
}

/**
 * Puts the queue request this job is printing on the printer.
 *
 * One already marked printing and waiting for its job wins — someone pressed
 * Start, or Send & start — then a waiting one for the exact file, then one for
 * the model with no file chosen, in queue order.
 */
async function attachRequest(db: Database, jobId: string): Promise<void> {
  await db.execute(sql`
    WITH job AS (
      SELECT id, model_id, model_file_id, started_at FROM printer_jobs WHERE id = ${jobId}
    ),
    candidate AS (
      SELECT r.id FROM print_requests r, job
      WHERE r.status IN ('requested', 'printing')
        AND r.printer_job_id IS NULL
        AND r.prints_done < r.quantity
        AND (r.model_file_id = job.model_file_id
             OR (r.model_file_id IS NULL AND r.model_id = job.model_id))
      ORDER BY (r.status = 'printing') DESC,
               (r.model_file_id IS NOT NULL) DESC,
               r.priority DESC, r.due_at ASC NULLS LAST, r.created_at ASC
      LIMIT 1
      FOR UPDATE OF r SKIP LOCKED
    ),
    attached AS (
      UPDATE print_requests r
      SET status = 'printing',
          started_at = coalesce(r.started_at, (SELECT started_at FROM job)),
          printer_job_id = ${jobId},
          updated_at = now()
      FROM candidate WHERE r.id = candidate.id
      RETURNING r.id
    )
    UPDATE printer_jobs SET request_id = (SELECT id FROM attached)
    WHERE id = ${jobId} AND EXISTS (SELECT 1 FROM attached)`)
}

type RequestFacts = {
  status: string
  quantity: number
  prints_done: number
  printer_job_id: string | null
  print_run_id: string | null
  material: string | null
  color_hex: string | null
  color_name: string | null
  requested_by: string | null
}

async function finishJob(
  db: Database,
  host: { id: string; name: string },
  job: OpenJob,
  outcome: JobOutcome,
  now: Date,
  status: PrinterStatus | null,
): Promise<void> {
  const progress = Math.max(Number(job.progress ?? 0), status?.progress ?? 0)
  const printSec = status?.elapsedSec ?? job.print_sec
  const startedAt = new Date(job.started_at)
  const durationMin =
    printSec != null && printSec > 0
      ? Math.round(printSec / 60)
      : Math.round((now.getTime() - startedAt.getTime()) / 60_000)

  const request = job.request_id
    ? (
        await db.execute<RequestFacts>(sql`
          SELECT status, quantity, prints_done, printer_job_id, print_run_id,
                 material, color_hex, color_name, requested_by
          FROM print_requests WHERE id = ${job.request_id}`)
      ).rows[0]
    : undefined

  let printRunId: string | null = null
  if (job.model_id) {
    if (request?.status === 'done' && request.print_run_id) {
      /*
       * Marked printed by hand while it was still on the printer: that already
       * wrote the history entry. Give it the printer's real times instead of
       * writing a second one.
       */
      printRunId = request.print_run_id
      await db.execute(sql`
        UPDATE print_runs
        SET started_at = ${startedAt}, finished_at = ${now}, duration_min = ${durationMin},
            printer_name = coalesce(printer_name, ${host.name}), updated_at = now()
        WHERE id = ${printRunId}`)
    } else {
      const filamentG =
        outcome === 'success' ? await plateFilamentG(db, job.model_id, job.model_file_id) : null
      const run = await logPrint(db, {
        modelId: job.model_id,
        modelFileId: job.model_file_id,
        recordingKey: `printer-job:${job.id}`,
        printerName: host.name,
        status: outcome === 'success' ? 'success' : 'failed',
        material: request?.material ?? null,
        colorHex: request?.color_hex ?? null,
        colorName: request?.color_name ?? null,
        startedAt,
        finishedAt: now,
        durationMin,
        filamentUsedG: filamentG,
        notes: jobNote(host.name, outcome, progress, request?.requested_by ?? null),
      })
      printRunId = run.id
    }
  }

  if (request && request.printer_job_id === job.id && request.status === 'printing') {
    const printed = outcome === 'success' ? request.prints_done + 1 : request.prints_done
    const complete = printed >= request.quantity
    await db.execute(sql`
      UPDATE print_requests
      SET prints_done = ${printed},
          printer_job_id = NULL,
          status = ${complete ? 'done' : 'requested'}::print_request_status,
          closed_at = ${complete ? sql`now()` : sql`NULL`},
          -- Kept on the finished request for its duration; a request going
          -- back to wait for its next print starts afresh.
          started_at = ${complete ? sql`started_at` : sql`NULL`},
          print_run_id = ${complete ? printRunId : sql`print_run_id`},
          updated_at = now()
      WHERE id = ${job.request_id}`)
  }

  await db.execute(sql`
    UPDATE printer_jobs
    SET status = ${outcome}, finished_at = ${now}, progress = ${progress},
        print_sec = ${roundOrNull(printSec)}, print_run_id = ${printRunId}
    WHERE id = ${job.id}`)
}

function jobNote(
  printerName: string,
  outcome: JobOutcome,
  progress: number,
  requestedBy: string | null,
): string {
  const how =
    outcome === 'success'
      ? `Printed on ${printerName}`
      : outcome === 'cancelled'
        ? `Cancelled on ${printerName} at ${Math.round(progress * 100)}%`
        : `Failed on ${printerName} at ${Math.round(progress * 100)}%`
  return requestedBy ? `${how}, for ${requestedBy}.` : `${how}.`
}

function roundOrNull(value: number | undefined | null): number | null {
  return value == null ? null : Math.round(value)
}

export interface PrinterSnapshot {
  id: string
  name: string
  /** The worker's last reading; null before it has read this printer at all. */
  status: PrinterStatus | null
  /** Whether that reading is recent enough to act on. */
  fresh: boolean
}

/** Every printer with the worker's last reading of it — no network, so always fast. */
export async function printerSnapshots(db: Database): Promise<PrinterSnapshot[]> {
  const rows = await db.execute<{
    id: string
    name: string
    status: PrinterStatus | null
    fresh: boolean | null
  }>(sql`
    SELECT id, name, status, (status_at > now() - interval '2 minutes') AS fresh
    FROM print_hosts ORDER BY name`)
  return rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    fresh: row.fresh === true,
  }))
}
