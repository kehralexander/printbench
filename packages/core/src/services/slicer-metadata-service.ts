import type { StorageAdapter } from '../storage/types'
import { parseGcodeMetadata, type GcodeMetadata } from '../slicer/gcode-metadata'
import {
  SLICER_THUMBNAIL_WINDOW_BYTES,
  extractSlicerThumbnails,
  type SlicerThumbnail,
} from '../slicer/gcode-thumbnails'

/**
 * Fetching the readable ends of a sliced file.
 *
 * The parser in ../slicer/gcode-metadata is pure and takes two strings. This is
 * the half that goes and gets them, and the only reason it is its own module: it
 * needs a storage adapter, and the parser is worth being able to test without
 * one.
 */

/**
 * How much of each end to read.
 *
 * PrusaSlicer's config block is around 8 KB and Orca's a little more; 64 KB
 * clears both with room for the summary lines that sit above them. It is also
 * small enough that doing this against S3 is two ranged GETs and not a download.
 */
const WINDOW_BYTES = 64 * 1024

/** Extensions worth opening. Anything else is not a sliced file. */
const GCODE_EXTENSIONS = new Set(['gcode', 'gco', 'g', 'ngc'])

export function isParsableSlicerFile(extension: string): boolean {
  return GCODE_EXTENSIONS.has(extension.toLowerCase().replace(/^\./, ''))
}

/**
 * Sliced files that may carry an embedded preview image: plain G-code and
 * binary G-code. Resin formats store previews in layouts of their own.
 */
export const THUMBNAIL_SLICER_EXTENSIONS: readonly string[] = [...GCODE_EXTENSIONS, 'bgcode']

export function hasSlicerThumbnail(extension: string): boolean {
  return THUMBNAIL_SLICER_EXTENSIONS.includes(extension.toLowerCase().replace(/^\./, ''))
}

/**
 * The preview images a slicer embedded at the head of a sliced file.
 *
 * One ranged read of the head, however large the file. Unlike the settings
 * reader this throws on storage errors: it runs in a job that records them.
 */
export async function readSlicerThumbnails(
  storage: StorageAdapter,
  relativePath: string,
  size: number | null,
): Promise<SlicerThumbnail[]> {
  const total = size ?? (await sizeOf(storage, relativePath))
  if (total == null || total === 0) return []
  const end = Math.min(total, SLICER_THUMBNAIL_WINDOW_BYTES) - 1
  return extractSlicerThumbnails(await readBytes(storage, relativePath, 0, end))
}

/**
 * Reads print settings out of a sliced G-code file.
 *
 * Never reads the whole file. A sliced plate is routinely hundreds of megabytes
 * of movement commands wrapped around a few kilobytes of comments, and pulling
 * all of it across to find the nozzle diameter would be slow locally and
 * expensive on S3.
 *
 * Returns an empty object rather than throwing when there is nothing to find —
 * an unreadable file means an unfilled form, which is exactly what the user had
 * before they clicked.
 */
export async function readGcodeMetadata(
  storage: StorageAdapter,
  relativePath: string,
  size: number | null,
): Promise<GcodeMetadata> {
  const total = size ?? (await sizeOf(storage, relativePath))
  if (total == null || total === 0) return {}

  try {
    // Small enough that two ranged reads would overlap anyway; take it in one.
    if (total <= WINDOW_BYTES * 2) {
      const whole = await readRange(storage, relativePath, 0, total - 1)
      return parseGcodeMetadata(whole, whole)
    }

    const [head, tail] = await Promise.all([
      readRange(storage, relativePath, 0, WINDOW_BYTES - 1),
      readRange(storage, relativePath, total - WINDOW_BYTES, total - 1),
    ])

    return parseGcodeMetadata(head, tail)
  } catch {
    /*
     * Swallowed on purpose. This runs to pre-fill a form the user is about to
     * fill in by hand anyway, so a missing file, a dead S3 endpoint or a
     * permissions problem should cost them the convenience and nothing else.
     * The storage layer logs its own failures.
     */
    return {}
  }
}

async function sizeOf(storage: StorageAdapter, relativePath: string): Promise<number | null> {
  try {
    const entry = await storage.stat(relativePath)
    return entry?.size ?? null
  } catch {
    return null
  }
}

/** `end` is inclusive, matching ByteRange and HTTP. */
async function readBytes(
  storage: StorageAdapter,
  relativePath: string,
  start: number,
  end: number,
): Promise<Buffer> {
  const stream = await storage.createReadStream(relativePath, { start, end })

  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  return Buffer.concat(chunks)
}

async function readRange(
  storage: StorageAdapter,
  relativePath: string,
  start: number,
  end: number,
): Promise<string> {
  const bytes = await readBytes(storage, relativePath, start, end)

  /*
   * G-code comments are ASCII. A multi-byte character clipped at the window
   * boundary decodes to a replacement character on one line, which the parser
   * discards along with the rest of that line.
   */
  return bytes.toString('utf8')
}
