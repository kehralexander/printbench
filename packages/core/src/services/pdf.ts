/**
 * Just enough PDF to print a receipt: text in Helvetica, and lines.
 *
 * A receipt is a page of text, and the standard 14 fonts every PDF reader
 * carries cover it — so this writes the file directly rather than pulling in
 * a PDF library and its fonts for one page. Text is WinAnsi-encoded, which
 * has €, £, the German umlauts and § — what an invoice from a European
 * hobbyist needs. Anything outside it prints as "?".
 */

export interface PdfTextItem {
  kind: 'text'
  x: number
  /** From the top of the page, in points; flipped on output. */
  y: number
  size: number
  text: string
  bold?: boolean
  /** Right-aligned at `x` rather than starting there. */
  align?: 'left' | 'right'
  /** Grey, for secondary text. */
  muted?: boolean
}

export interface PdfLineItem {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  width?: number
}

export type PdfItem = PdfTextItem | PdfLineItem

/** A4, in points. */
export const PAGE_WIDTH = 595.28
export const PAGE_HEIGHT = 841.89

/** Helvetica advance widths for ASCII 32–126, per 1000 units of font size. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

/** The width of a line of text, in points. Bold runs a little wider. */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    units += code >= 32 && code <= 126 ? HELVETICA[code - 32]! : 556
  }
  return ((units * size) / 1000) * (bold ? 1.06 : 1)
}

/** Splits text into lines no wider than `width`, breaking at spaces. */
export function wrapText(text: string, size: number, width: number, bold = false): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && textWidth(next, size, bold) > width) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    lines.push(line)
  }
  return lines
}

/** Renders pages of items into a complete PDF file. */
export function renderPdf(pages: PdfItem[][], title = 'Document'): Uint8Array {
  const objects: string[] = []
  const add = (body: string) => {
    objects.push(body)
    return objects.length
  }

  const catalog = add('') // filled in once the page tree exists
  const pagesId = add('')
  const regular = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  )
  const bold = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  )
  const info = add(`<< /Title (${escape(encode(title))}) /Producer (PrintBench) >>`)

  const pageIds: number[] = []
  for (const items of pages) {
    const content = items.map(draw).join('\n')
    const stream = add(`<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`)
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${stream} 0 R >>`,
      ),
    )
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let out = '%PDF-1.4\n%âãÏÓ\n'
  const offsets: number[] = []
  for (const [index, body] of objects.entries()) {
    offsets.push(byteLength(out))
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  }
  const xref = byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\n`
  out += `startxref\n${xref}\n%%EOF\n`

  // Every character is already a single byte (see encode), so latin1 is exact.
  return new Uint8Array(Buffer.from(out, 'latin1'))
}

function draw(item: PdfItem): string {
  if (item.kind === 'line') {
    return `${item.width ?? 0.5} w ${num(item.x1)} ${num(PAGE_HEIGHT - item.y1)} m ${num(item.x2)} ${num(PAGE_HEIGHT - item.y2)} l S`
  }
  const text = encode(item.text)
  const x = item.align === 'right' ? item.x - textWidth(item.text, item.size, item.bold) : item.x
  const colour = item.muted ? '0.4 g' : '0 g'
  return `BT ${colour} /${item.bold ? 'F2' : 'F1'} ${item.size} Tf ${num(x)} ${num(PAGE_HEIGHT - item.y)} Td (${escape(text)}) Tj ET`
}

function num(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

/** WinAnsi: Latin-1 plus the few Windows-1252 extras an invoice uses. */
const WIN_ANSI_EXTRAS: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '–': 0x96,
  '—': 0x97,
  '™': 0x99,
}

/** Text as one byte per character, each a WinAnsi code, held in a JS string. */
function encode(text: string): string {
  let out = ''
  for (const char of text.normalize('NFC')) {
    const extra = WIN_ANSI_EXTRAS[char]
    if (extra != null) out += String.fromCharCode(extra)
    else {
      const code = char.codePointAt(0)!
      out += (code >= 32 && code <= 126) || (code >= 160 && code <= 255) ? char : '?'
    }
  }
  return out
}

function escape(text: string): string {
  return text.replace(/[\\()]/g, (char) => `\\${char}`)
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'latin1')
}
