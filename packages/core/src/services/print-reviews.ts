import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import type { Database } from '@pb/db'

/**
 * "How did it go?" for prints the printer logged by itself.
 *
 * The tracker writes the history entry the moment a print ends, but only a
 * person can say whether it came out well. Those entries stay in an "unrated"
 * list for a while — rate it, add a photo, or wave it off — and nothing else
 * changes about them.
 */

/** Older than this, nobody remembers how it came out; the prompt lets it go. */
const REVIEW_WINDOW = sql`interval '14 days'`

export interface UnratedPrint {
  id: string
  modelName: string
  modelPublicId: string
  filename: string | null
  printerName: string | null
  status: 'success' | 'failed' | 'partial' | 'in_progress'
  notes: string | null
  finishedAt: Date | null
  durationMin: number | null
  hasPhoto: boolean
}

export async function unratedPrints(db: Database, limit = 5): Promise<UnratedPrint[]> {
  const rows = await db.execute<{
    id: string
    model_name: string
    model_public_id: string
    filename: string | null
    printer_name: string | null
    status: UnratedPrint['status']
    notes: string | null
    finished_at: Date | null
    duration_min: number | null
    photo_key: string | null
  }>(sql`
    SELECT p.id, m.name AS model_name, m.public_id AS model_public_id, f.filename,
           p.printer_name, p.status, p.notes, p.finished_at, p.duration_min, p.photo_key
    FROM print_runs p
    JOIN models m ON m.id = p.model_id
    LEFT JOIN model_files f ON f.id = p.model_file_id
    WHERE p.recording_key LIKE '%:printer-job:%'
      AND p.rating IS NULL AND p.review_dismissed_at IS NULL
      AND coalesce(p.finished_at, p.created_at) > now() - ${REVIEW_WINDOW}
    ORDER BY coalesce(p.finished_at, p.created_at) DESC
    LIMIT ${Math.min(Math.max(limit, 1), 50)}`)
  return rows.rows.map((row) => ({
    id: row.id,
    modelName: row.model_name,
    modelPublicId: row.model_public_id,
    filename: row.filename,
    printerName: row.printer_name,
    status: row.status,
    notes: row.notes,
    finishedAt: row.finished_at ? new Date(row.finished_at) : null,
    durationMin: row.duration_min,
    hasPhoto: row.photo_key != null,
  }))
}

export class ReviewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewError'
  }
}

/**
 * Records how a print came out: 1–5 stars, an optional line appended to the
 * note the tracker wrote, and — when it looked fine to the printer but was
 * not — that it failed after all.
 */
export async function reviewPrint(
  db: Database,
  printId: string,
  review: { rating: number; note?: string | null; failed?: boolean },
): Promise<void> {
  if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) {
    throw new ReviewError('A rating is one to five stars.')
  }
  const note = review.note?.trim().slice(0, 1000) || null
  await db.execute(sql`
    UPDATE print_runs
    SET rating = ${review.rating},
        notes = CASE WHEN ${note}::text IS NULL THEN notes
                     ELSE concat_ws(E'\\n', notes, ${note}::text) END,
        status = ${review.failed ? sql`'failed'::print_status` : sql`status`},
        updated_at = now()
    WHERE id = ${printId}`)
}

export async function dismissReview(db: Database, printId: string): Promise<void> {
  await db.execute(sql`
    UPDATE print_runs SET review_dismissed_at = now() WHERE id = ${printId}`)
}

/* ------------------------------------------------------------------ *
 * Photos
 * ------------------------------------------------------------------ */

/** A phone photo, comfortably; anything bigger is not a snapshot of a print. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024

const PHOTO_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const

export type PhotoExtension = keyof typeof PHOTO_TYPES

/** What the bytes are, from their first few — never from the name or the browser. */
export function photoExtension(data: Buffer): PhotoExtension | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg'
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png'
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

const PHOTO_KEY = /^[0-9a-f]{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/

/** Photos live under DATA_DIR/photos, next to the generated previews. */
function photoRoot(): string {
  const configured = process.env.DATA_DIR ?? './data'
  if (path.isAbsolute(configured)) return path.join(configured, 'photos')
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(path.resolve(here, '../../../..', configured), 'photos')
}

function photoPath(key: string): string {
  if (!PHOTO_KEY.test(key)) throw new Error(`Refusing a malformed photo key: ${key}`)
  return path.join(photoRoot(), key)
}

/** Stores a photo for a print, replacing any earlier one. */
export async function setPrintPhoto(db: Database, printId: string, data: Buffer): Promise<void> {
  if (data.length === 0) throw new ReviewError('That photo is empty.')
  if (data.length > MAX_PHOTO_BYTES)
    throw new ReviewError('That photo is too large (15 MB at most).')
  const extension = photoExtension(data)
  if (!extension) throw new ReviewError('Use a JPEG, PNG or WebP photo.')

  const id = randomUUID()
  const key = `${id.slice(0, 2)}/${id}.${extension}`
  const target = photoPath(key)
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, target)

  const previous = await db.execute<{ photo_key: string | null }>(sql`
    UPDATE print_runs p SET photo_key = ${key}, updated_at = now()
    FROM (SELECT id, photo_key FROM print_runs WHERE id = ${printId} FOR UPDATE) old
    WHERE p.id = old.id
    RETURNING old.photo_key`)
  if (previous.rows.length === 0) {
    await rm(target, { force: true })
    throw new ReviewError('That print is no longer in the history.')
  }
  const old = previous.rows[0]?.photo_key
  if (old && PHOTO_KEY.test(old)) await rm(photoPath(old), { force: true })
}

export async function readPrintPhoto(
  db: Database,
  printId: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const rows = await db.execute<{ photo_key: string | null }>(sql`
    SELECT photo_key FROM print_runs WHERE id = ${printId}`)
  const key = rows.rows[0]?.photo_key
  if (!key || !PHOTO_KEY.test(key)) return null
  const data = await readFile(photoPath(key)).catch(() => null)
  if (!data) return null
  const extension = key.split('.').pop() as PhotoExtension
  return { data, contentType: PHOTO_TYPES[extension] }
}

/** Removes a deleted print's photo from disk; quietly, it is only clean-up. */
export async function removePhotoFile(key: string | null | undefined): Promise<void> {
  if (!key || !PHOTO_KEY.test(key)) return
  await rm(photoPath(key), { force: true }).catch(() => undefined)
}
