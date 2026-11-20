import type { StorageAdapter } from '../storage/types'
import { parseGcodeMetadata, type GcodeMetadata } from '../slicer/gcode-metadata'
import { scanUsedToolsStream, type GcodeTool } from '../slicer/gcode-tools'
import { scanGcodeBodyStream } from '../slicer/gcode-body-scan'
import {
  SLICER_META_VERSION,
  buildSlicerFileMeta,
  type SlicerFileMeta,
} from '../slicer/gcode-file-meta'
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
export const PARSABLE_SLICER_EXTENSIONS: readonly string[] = ['gcode', 'gco', 'g', 'ngc']
const GCODE_EXTENSIONS = new Set(PARSABLE_SLICER_EXTENSIONS)

export function isParsableSlicerFile(extension: string): boolean {
  return GCODE_EXTENSIONS.has(extension.toLowerCase().replace(/^\./, ''))
}

/**
 * A file's stored read (model_files.slicer_meta), when the current reader made
 * it. Null means the job has not reached the file yet, or last read it with an
 * older reader, or could not read it: read the file instead.
 */
export function storedSlicerMeta(row: {
  slicerMeta: unknown
  slicerMetaVersion: number | null
}): SlicerFileMeta | null {
  if (row.slicerMetaVersion !== SLICER_META_VERSION || row.slicerMeta == null) return null
  return row.slicerMeta as SlicerFileMeta
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
    const { head, tail } = await readEnds(storage, relativePath, total)
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

/**
 * The settings plus every filament the file prints with, with which tools
 * the body really changes to.
 *
 * Finding those means reading the whole file, so this is for when a file is
 * linked to something — once — and never for a page render. A file with a
 * single tool is not scanned: there is nothing to tell apart.
 */
export async function readGcodeWithTools(
  storage: StorageAdapter,
  relativePath: string,
  size: number | null,
): Promise<GcodeMetadata & { filaments: GcodeTool[] }> {
  const metadata = await readGcodeMetadata(storage, relativePath, size)
  const listed = metadata.filaments ?? []
  if (listed.length <= 1) return { ...metadata, filaments: listed }

  try {
    const used = await scanUsedToolsStream(await storage.createReadStream(relativePath))
    if (used.size === 0) return { ...metadata, filaments: listed }
    // Same rule as readGcodeTools: tool changes, once seen, settle it.
    return {
      ...metadata,
      filaments: listed.map((tool) => ({ ...tool, used: used.has(tool.tool) })),
    }
  } catch {
    // The header's answer is still an answer.
    return { ...metadata, filaments: listed }
  }
}

/**
 * Everything a sliced file says about itself and everything a full read of
 * its body finds, for model_files.slicer_meta.
 *
 * Reads the whole file, so this belongs in a background job and nowhere else.
 * Throws on storage errors, which the job records.
 */
export async function readSlicerFileMeta(
  storage: StorageAdapter,
  relativePath: string,
  size: number | null,
): Promise<SlicerFileMeta> {
  const total = size ?? (await sizeOf(storage, relativePath))
  if (total == null || total === 0) return {}

  const { head, tail } = await readEnds(storage, relativePath, total)
  // Binary G-code is compressed blocks; there is no text body to scan.
  if (head.startsWith('GCDE')) return {}

  const body = await scanGcodeBodyStream(await storage.createReadStream(relativePath))
  return buildSlicerFileMeta(head, tail, body)
}

/** The first and last WINDOW_BYTES of a file, or the whole of a small one twice. */
async function readEnds(
  storage: StorageAdapter,
  relativePath: string,
  total: number,
): Promise<{ head: string; tail: string }> {
  // Small enough that two ranged reads would overlap anyway; take it in one.
  if (total <= WINDOW_BYTES * 2) {
    const whole = await readRange(storage, relativePath, 0, total - 1)
    return { head: whole, tail: whole }
  }

  const [head, tail] = await Promise.all([
    readRange(storage, relativePath, 0, WINDOW_BYTES - 1),
    readRange(storage, relativePath, total - WINDOW_BYTES, total - 1),
  ])
  return { head, tail }
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
