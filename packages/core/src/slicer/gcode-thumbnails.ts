/**
 * Preview images that slicers embed in the files they write.
 *
 * PrusaSlicer, SuperSlicer, Orca and Cura (with its thumbnail plugin) put one
 * or more base64 images in comment blocks near the start of a G-code file:
 *
 *   ; thumbnail begin 300x300 12345
 *   ; iVBORw0KGgoAAAANSUhEUgAA...
 *   ; thumbnail end
 *
 * with `thumbnail_PNG`, `thumbnail_JPG` and `thumbnail_QOI` variants. Binary
 * G-code (.bgcode) carries the same images as dedicated thumbnail blocks before
 * the first G-code block.
 *
 * Both live at the head of the file, so this is handed the first stretch of it
 * and never the rest. A block cut off by the window is dropped rather than
 * decoded halfway. Only PNG and JPEG come back: QOI would need a decoder of its
 * own, and slicers that write it write a PNG alongside.
 */

export interface SlicerThumbnail {
  data: Uint8Array
  contentType: 'image/png' | 'image/jpeg'
}

/** Enough for several thumbnail sizes ahead of the first movement command. */
export const SLICER_THUMBNAIL_WINDOW_BYTES = 2 * 1024 * 1024

/** More than any slicer writes; a cap so a malformed file cannot balloon the list. */
const MAX_THUMBNAILS = 16

const BEGIN = /^;\s*(?:thumbnail(?:_(png|jpg|qoi))?|(png|jpg))\s+begin\b/i
const END = /^;\s*(?:thumbnail(?:_(?:png|jpg|qoi))?|png|jpg)\s+end\b/i

export function extractSlicerThumbnails(head: Uint8Array): SlicerThumbnail[] {
  const bytes = Buffer.from(head.buffer, head.byteOffset, head.byteLength)
  if (bytes.subarray(0, 4).toString('latin1') === 'GCDE') return binaryThumbnails(bytes)
  return textThumbnails(bytes.toString('latin1'))
}

function textThumbnails(text: string): SlicerThumbnail[] {
  const out: SlicerThumbnail[] = []
  let collecting: string[] | null = null
  let skip = false

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (collecting === null) {
      const begin = BEGIN.exec(line)
      if (!begin) continue
      skip = (begin[1] ?? begin[2] ?? '').toLowerCase() === 'qoi'
      collecting = []
      continue
    }

    if (END.test(line)) {
      if (!skip) {
        const image = classify(Buffer.from(collecting.join(''), 'base64'))
        if (image) out.push(image)
      }
      collecting = null
      if (out.length >= MAX_THUMBNAILS) break
      continue
    }

    // Anything that is not a comment means the block never ended properly.
    if (!line.startsWith(';')) {
      collecting = null
      continue
    }
    collecting.push(line.replace(/^;\s*/, ''))
  }

  return out
}

/**
 * Walks bgcode blocks up to the first G-code block.
 *
 * Layout (libbgcode): a 10-byte file header — magic, u32 version, u16 checksum
 * type — then blocks of u16 type, u16 compression, u32 uncompressed size, a u32
 * compressed size only when compressed, block parameters (6 bytes for a
 * thumbnail: u16 format, width, height; 2 bytes otherwise), the payload, and a
 * 4-byte CRC32 when the file uses checksums.
 */
function binaryThumbnails(bytes: Buffer): SlicerThumbnail[] {
  const BLOCK_GCODE = 1
  const BLOCK_THUMBNAIL = 5
  const out: SlicerThumbnail[] = []

  if (bytes.length < 10) return out
  const checksumBytes = bytes.readUInt16LE(8) === 1 ? 4 : 0
  let offset = 10

  while (offset + 8 <= bytes.length && out.length < MAX_THUMBNAILS) {
    const type = bytes.readUInt16LE(offset)
    const compression = bytes.readUInt16LE(offset + 2)
    const uncompressed = bytes.readUInt32LE(offset + 4)
    let cursor = offset + 8
    let payloadSize = uncompressed
    if (compression !== 0) {
      if (cursor + 4 > bytes.length) break
      payloadSize = bytes.readUInt32LE(cursor)
      cursor += 4
    }

    if (type === BLOCK_GCODE) break
    const paramsSize = type === BLOCK_THUMBNAIL ? 6 : 2
    const payloadStart = cursor + paramsSize
    const next = payloadStart + payloadSize + checksumBytes
    if (next > bytes.length) break

    // Thumbnails are stored uncompressed; anything else is not one we can read.
    if (type === BLOCK_THUMBNAIL && compression === 0) {
      const image = classify(bytes.subarray(payloadStart, payloadStart + payloadSize))
      if (image) out.push(image)
    }
    offset = next
  }

  return out
}

/** Trusts the bytes, not the label the slicer put on them. */
function classify(data: Buffer): SlicerThumbnail | null {
  const png = data.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => data[i] === n)
  if (png) return { data: new Uint8Array(data), contentType: 'image/png' }
  const jpeg = data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
  if (jpeg) return { data: new Uint8Array(data), contentType: 'image/jpeg' }
  return null
}
