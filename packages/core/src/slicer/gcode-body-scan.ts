/**
 * One pass over the body of a G-code file: the things only the toolpaths know.
 *
 * Where gcode-metadata and gcode-details read the two ends of a file, this
 * reads every line, which for a large plate is hundreds of megabytes. It runs
 * once per file version in a background job and the result is stored; it is
 * never for a page render.
 *
 * What it finds:
 *
 *   pauses        M600 filament changes, M601/M0/M1/M25/PAUSE pauses and
 *                 Bambu's `M400 U1`, with the layer each falls on and how far
 *                 into the print, from the M73 progress the slicer wrote
 *   tool changes  how many, and when — the swaps a single-nozzle multi-colour
 *                 printer spends its time and filament on
 *   extents       the box the extrusion really fills, and so the print height
 *   layers        counted from the slicer's layer markers, or failing those
 *                 from the heights extrusion happens at
 *   objects       Klipper's EXCLUDE_OBJECT_DEFINE, M486 labels and the
 *                 slicers' own object comments
 *   purge         filament extruded into wipe and prime towers and Bambu's
 *                 flushes, per tool
 *
 * Like the header readers it is timid. A command it does not know is skipped,
 * and a figure it could not establish is null rather than zero.
 */

import type { GcodeExtents } from './gcode-details'

export type GcodePauseKind = 'filament_change' | 'pause'

/** Where in the print something happens. */
export interface GcodeWhen {
  /** 1-based, counting the slicer's layer markers; null before the first. */
  layer: number | null
  zMm: number | null
  /** From the slicer's M73 remaining-time figures. */
  elapsedMin: number | null
  /** From M73 P. */
  progressPercent: number | null
}

export interface GcodePause extends GcodeWhen {
  kind: GcodePauseKind
  /** As written: "M600", "M601", "PAUSE", "M400 U1", … */
  command: string
  /** The colour to load, where the slicer said (Prusa's `;COLOR_CHANGE,T0,#rrggbb`). */
  colorHex: string | null
  tool: number | null
}

export interface GcodeToolChange extends GcodeWhen {
  from: number
  to: number
}

export interface GcodeBodyScan {
  layerCount: number | null
  /** Highest point extrusion reaches. */
  maxZMm: number | null
  /** Where extrusion happens, from the first layer on — the start-code purge line is not the print. */
  extents: GcodeExtents | null
  /** Every T<n> the body selects. The same rule as scanUsedTools. */
  usedTools: number[]
  /** Switches from one tool to another; the first selection is not a change. */
  toolChanges: number
  /** The first TOOL_CHANGE_LIMIT changes. */
  toolChangeTimeline: GcodeToolChange[]
  pauses: GcodePause[]
  /** Names, where the file labels its objects. */
  objects: string[]
  /** How many objects, where the file says; null when it does not label them. */
  objectCount: number | null
  /** Millimetres of filament into towers and flushes, per tool that purged. */
  purgeMm: { tool: number; mm: number }[]
  /** The slicer's M73 estimate of the whole print, when it wrote one. */
  progressTotalMin: number | null
}

/** Bounds on what is kept, so one pathological file cannot bloat its row. */
export const TOOL_CHANGE_LIMIT = 1000
export const PAUSE_LIMIT = 200
export const OBJECT_LIMIT = 500

/** Where an object's name came from, most deliberate first. */
const OBJECT_SOURCES = ['klipper', 'm486', 'info', 'comment', 'mesh'] as const
type ObjectSource = (typeof OBJECT_SOURCES)[number]

/** Tools above this are firmware sentinels — Prusa's T255, Bambu's T1000 — not a filament. */
const MAX_TOOL = 99

/** Accumulates a scan line by line. Exposed for tests; use scanGcodeBody(Stream). */
export class GcodeBodyScanner {
  // Position, in millimetres. NaN until the file establishes it.
  private x = Number.NaN
  private y = Number.NaN
  private z = Number.NaN
  private e = 0
  private relativeXyz = false
  private relativeE = false

  private tool: number | null = null
  private readonly used = new Set<number>()
  private changes = 0
  private readonly timeline: GcodeToolChange[] = []
  private readonly pauses: GcodePause[] = []
  private pendingColour: { tool: number | null; colorHex: string | null } | null = null

  /*
   * Layer markers come in families — Prusa and Orca `;LAYER_CHANGE`, Bambu
   * `; CHANGE_LAYER`, Cura `;LAYER:n`, Klipper `SET_PRINT_STATS_INFO` — and
   * some slicers write two of them. Each is counted apart and the largest
   * believed, so a file with both is not counted twice.
   */
  private readonly layerCounts = new Map<string, number>()
  private layer = 0
  private layerZ = Number.NaN
  private totalLayersHint: number | null = null

  private extrusionLayers = 0
  private lastExtrusionZ = Number.NaN

  private readonly printBox = emptyBox()
  private readonly allBox = emptyBox()

  private inTower = false
  private inFlush = false
  private readonly purge = new Map<number, number>()

  /*
   * Objects are named by several markers at once, each spelling the names its
   * own way — Orca writes "Cube.stl id:3 copy 0" in a comment and
   * "Cube_stl_id_3_copy_0" for Klipper. Kept apart, and the most deliberate
   * source wins, so one object is never counted twice.
   */
  private readonly objectNames = new Map<ObjectSource, Set<string>>()
  private readonly objectIds = new Set<number>()

  private progressTotal: number | null = null
  private remaining: number | null = null
  private percent: number | null = null

  line(raw: string): void {
    let start = 0
    while (start < raw.length && (raw.charCodeAt(start) === 32 || raw.charCodeAt(start) === 9)) {
      start++
    }
    if (start >= raw.length) return

    if (raw.charCodeAt(start) === 59 /* ; */) {
      this.comment(raw.slice(start + 1).trim())
      return
    }

    const semicolon = raw.indexOf(';', start)
    const code = (semicolon < 0 ? raw.slice(start) : raw.slice(start, semicolon)).trim()
    if (code) this.command(code)
  }

  result(): GcodeBodyScan {
    const markerLayers = Math.max(0, ...this.layerCounts.values())
    const layerCount =
      markerLayers > 0
        ? markerLayers
        : (this.totalLayersHint ?? (this.extrusionLayers > 0 ? this.extrusionLayers : null))

    // From the first layer on when the file marks layers; everything otherwise.
    const box = isEmpty(this.printBox) ? this.allBox : this.printBox
    const extents = isEmpty(box) ? null : roundBox(box)

    const source = OBJECT_SOURCES.find((candidate) => this.objectNames.get(candidate)?.size)
    const names = source ? [...this.objectNames.get(source)!] : []
    const objectCount = names.length > 0 ? names.length : this.objectIds.size || null

    return {
      layerCount,
      maxZMm: extents ? extents.maxZ : null,
      extents,
      usedTools: [...this.used].sort((a, b) => a - b),
      toolChanges: this.changes,
      toolChangeTimeline: this.timeline,
      pauses: this.pauses,
      objects: names,
      objectCount,
      purgeMm: [...this.purge]
        .filter(([, mm]) => mm > 0)
        .sort(([a], [b]) => a - b)
        .map(([tool, mm]) => ({ tool, mm: round(mm, 2) })),
      progressTotalMin: this.progressTotal,
    }
  }

  // --- comments -------------------------------------------------------------

  private comment(body: string): void {
    if (!body) return
    const upper = body.toUpperCase()

    if (upper === 'LAYER_CHANGE') return this.nextLayer('prusa')
    if (upper === 'CHANGE_LAYER') return this.nextLayer('bambu')
    if (upper.startsWith('LAYER:')) {
      // Cura numbers from 0, and from below 0 for raft layers; every one is a layer.
      if (/^LAYER:\s*-?\d+\s*$/.test(upper)) this.nextLayer('cura')
      return
    }

    if (upper.startsWith('Z:') || upper.startsWith('Z_HEIGHT:')) {
      const value = Number.parseFloat(body.slice(body.indexOf(':') + 1))
      if (Number.isFinite(value)) this.layerZ = value
      return
    }

    // Feature regions: towers and flushes are where purge goes.
    if (upper.startsWith('TYPE:') || upper.startsWith('FEATURE:')) {
      this.inTower = /PRIME|WIPE/.test(upper)
      return
    }
    if (upper === 'FLUSH_START') {
      this.inFlush = true
      return
    }
    if (upper === 'FLUSH_END') {
      this.inFlush = false
      return
    }

    // Prusa: ";COLOR_CHANGE,T0,#ff8000", immediately before its M600.
    if (upper.startsWith('COLOR_CHANGE')) {
      const tool = /,\s*T(\d+)/i.exec(body)
      const colour = /#([0-9a-f]{6})\b/i.exec(body)
      this.pendingColour = {
        tool: tool ? Number(tool[1]) : null,
        colorHex: colour ? `#${colour[1]!.toLowerCase()}` : null,
      }
      return
    }

    // Objects. Prusa and Orca: "; printing object Box id:0 copy 0" — the copy
    // number is what tells ten copies of one part apart.
    const printing = /^printing object\s+(.+)$/i.exec(body)
    if (printing?.[1]) return this.object('comment', printing[1])
    if (upper.startsWith('MESH:')) {
      const name = body.slice(5).trim()
      // Cura's travel and skirt sections are "NONMESH".
      if (name && name.toUpperCase() !== 'NONMESH') this.object('mesh', name)
      return
    }
    if (upper.startsWith('OBJECTS_INFO')) {
      const json = body.slice(body.indexOf('=') + 1).trim()
      try {
        const info = JSON.parse(json) as { objects?: { name?: unknown }[] }
        for (const entry of info.objects ?? []) {
          if (typeof entry.name === 'string') this.object('info', entry.name)
        }
      } catch {
        // Not JSON after all; the other markers will do.
      }
    }
  }

  // --- commands -------------------------------------------------------------

  private command(code: string): void {
    const first = code.charCodeAt(0)

    // G0-G3 are nearly every line of the file, so they come first.
    if (first === 71 /* G */ || first === 103 /* g */) {
      const word = commandWord(code)
      if (word === 'G0' || word === 'G1' || word === 'G2' || word === 'G3') {
        this.move(code, word !== 'G0')
      } else if (word === 'G90') this.relativeXyz = false
      else if (word === 'G91') this.relativeXyz = true
      else if (word === 'G92') this.setPosition(code)
      else if (word === 'G28') this.home(code)
      return
    }

    if (first === 84 /* T */ || first === 116 /* t */) {
      const match = /^T(\d+)\b/i.exec(code)
      if (match) this.selectTool(Number(match[1]))
      return
    }

    const word = commandWord(code)
    switch (word) {
      case 'M82':
        this.relativeE = false
        return
      case 'M83':
        this.relativeE = true
        return
      case 'M73':
        return this.progress(code)
      case 'M600':
        return this.pause('filament_change', 'M600')
      case 'M601':
      case 'M0':
      case 'M1':
      case 'M25':
      case 'PAUSE':
        return this.pause('pause', word)
      case 'M400':
        // Bambu's pause; a bare M400 just waits for moves to finish.
        if (params(code).has('U')) this.pause('pause', 'M400 U1')
        return
      case 'M486':
        return this.labelObject(code)
      case 'EXCLUDE_OBJECT_DEFINE': {
        const name = /\bNAME=("[^"]*"|\S+)/i.exec(code)?.[1]
        if (name) this.object('klipper', name.replace(/^"|"$/g, ''))
        return
      }
      case 'SET_PRINT_STATS_INFO': {
        const total = /\bTOTAL_LAYER=(\d+)/i.exec(code)
        if (total) this.totalLayersHint = Number(total[1])
        if (/\bCURRENT_LAYER=\d+/i.test(code)) this.nextLayer('klipper')
        return
      }
    }
  }

  private move(code: string, mayExtrude: boolean): void {
    const values = params(code)
    const fromX = this.x
    const fromY = this.y

    const axis = (letter: string, current: number) => {
      const value = values.get(letter)
      if (value == null) return current
      return this.relativeXyz ? current + value : value
    }
    this.x = axis('X', this.x)
    this.y = axis('Y', this.y)
    this.z = axis('Z', this.z)

    const e = values.get('E')
    if (!mayExtrude || e == null) {
      if (e != null && !this.relativeE) this.e = e
      return
    }

    const delta = this.relativeE ? e : e - this.e
    if (!this.relativeE) this.e = e
    if (!(delta > 0)) return

    if (this.inTower || this.inFlush) {
      const tool = this.tool ?? 0
      this.purge.set(tool, (this.purge.get(tool) ?? 0) + delta)
    }

    // A move with no X or Y is priming or a flush in place, not the print.
    if (!values.has('X') && !values.has('Y')) return
    // Bambu flushes over the purge chute, which is off the bed.
    if (this.inFlush) return

    // A file that never moves Z explicitly still says the height in its layer markers.
    const z = Number.isFinite(this.z) ? this.z : this.layerZ
    if (Number.isFinite(z) && !(z <= this.lastExtrusionZ + 1e-4)) {
      this.extrusionLayers++
      this.lastExtrusionZ = z
    }

    for (const box of this.layer > 0 ? [this.allBox, this.printBox] : [this.allBox]) {
      include(box, fromX, fromY, z)
      include(box, this.x, this.y, z)
    }
  }

  private setPosition(code: string): void {
    const values = params(code)
    // A bare G92 zeroes every axis.
    const all = values.size === 0
    if (all || values.has('X')) this.x = values.get('X') ?? 0
    if (all || values.has('Y')) this.y = values.get('Y') ?? 0
    if (all || values.has('Z')) this.z = values.get('Z') ?? 0
    if (all || values.has('E')) this.e = values.get('E') ?? 0
  }

  private home(code: string): void {
    const values = params(code)
    const all = !values.has('X') && !values.has('Y') && !values.has('Z')
    // Where home is depends on the machine; zero is the usual answer and the
    // next absolute move corrects it either way.
    if (all || values.has('X')) this.x = 0
    if (all || values.has('Y')) this.y = 0
    if (all || values.has('Z')) this.z = 0
  }

  private selectTool(tool: number): void {
    this.used.add(tool)
    if (tool > MAX_TOOL) return
    if (this.tool != null && this.tool !== tool) {
      this.changes++
      if (this.timeline.length < TOOL_CHANGE_LIMIT) {
        this.timeline.push({ from: this.tool, to: tool, ...this.when() })
      }
    }
    this.tool = tool
  }

  private pause(kind: GcodePauseKind, command: string): void {
    const colour = kind === 'filament_change' ? this.pendingColour : null
    this.pendingColour = null
    if (this.pauses.length >= PAUSE_LIMIT) return
    this.pauses.push({
      kind,
      command,
      colorHex: colour?.colorHex ?? null,
      tool: colour?.tool ?? this.tool,
      ...this.when(),
    })
  }

  private progress(code: string): void {
    const values = params(code)
    // P and R are normal mode; Prusa writes Q and S for silent mode alongside.
    const percent = values.get('P')
    const remaining = values.get('R')
    if (percent != null && percent >= 0 && percent <= 100) this.percent = percent
    if (remaining != null && remaining >= 0) {
      if (this.progressTotal == null) this.progressTotal = remaining
      this.remaining = remaining
    }
  }

  private labelObject(code: string): void {
    const label = /\bA("?)(.+?)\1\s*$/.exec(code)
    if (label?.[2]) {
      this.object('m486', label[2])
      return
    }
    const id = params(code).get('S')
    // S-1 means "no object", not an object.
    if (id != null && id >= 0 && this.objectIds.size < OBJECT_LIMIT) this.objectIds.add(id)
  }

  private object(source: ObjectSource, name: string): void {
    const clean = name.trim()
    if (!clean) return
    let names = this.objectNames.get(source)
    if (!names) {
      names = new Set()
      this.objectNames.set(source, names)
    }
    if (names.size < OBJECT_LIMIT) names.add(clean)
  }

  private nextLayer(family: string): void {
    const count = (this.layerCounts.get(family) ?? 0) + 1
    this.layerCounts.set(family, count)
    this.layer = Math.max(this.layer, count)
  }

  private when(): GcodeWhen {
    const z = Number.isFinite(this.layerZ) ? this.layerZ : this.z
    return {
      layer: this.layer > 0 ? this.layer : null,
      zMm: Number.isFinite(z) ? round(z, 3) : null,
      elapsedMin:
        this.progressTotal != null && this.remaining != null
          ? Math.max(0, this.progressTotal - this.remaining)
          : null,
      progressPercent: this.percent,
    }
  }
}

/** Scans G-code held as one string. */
export function scanGcodeBody(text: string): GcodeBodyScan {
  const scanner = new GcodeBodyScanner()
  for (const line of text.split('\n')) scanner.line(line)
  return scanner.result()
}

/**
 * The same over a stream, in constant memory. Keeps the unfinished last line
 * of each chunk so a command split across two chunks is read whole.
 */
export async function scanGcodeBodyStream(
  chunks: AsyncIterable<Uint8Array | string>,
): Promise<GcodeBodyScan> {
  const scanner = new GcodeBodyScanner()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let carry = ''
  for await (const chunk of chunks) {
    const text =
      carry + (typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }))
    let from = 0
    for (let cut = text.indexOf('\n'); cut >= 0; cut = text.indexOf('\n', from)) {
      scanner.line(text.slice(from, cut))
      from = cut + 1
    }
    carry = text.slice(from)
  }
  scanner.line(carry + decoder.decode())
  return scanner.result()
}

/** "G1", "M600", "PAUSE": the first word, uppercased, without leading zeros ("G01" is G1). */
function commandWord(code: string): string {
  const space = code.search(/\s/)
  const word = (space < 0 ? code : code.slice(0, space)).toUpperCase()
  return word.replace(/^([GM])0+(\d)/, '$1$2')
}

/** "G1 X10 Y-2.5 E.4" -> X:10, Y:-2.5, E:0.4. A letter with no number is present as NaN. */
function params(code: string): Map<string, number> {
  const out = new Map<string, number>()
  const words = code.split(/\s+/)
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!
    if (!word) continue
    const letter = word[0]!.toUpperCase()
    if (letter < 'A' || letter > 'Z') continue
    out.set(letter, Number.parseFloat(word.slice(1)))
  }
  return out
}

type Box = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

function emptyBox(): Box {
  return {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  }
}

function include(box: Box, x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  box.minX = Math.min(box.minX, x)
  box.maxX = Math.max(box.maxX, x)
  box.minY = Math.min(box.minY, y)
  box.maxY = Math.max(box.maxY, y)
  if (Number.isFinite(z)) {
    box.minZ = Math.min(box.minZ, z)
    box.maxZ = Math.max(box.maxZ, z)
  }
}

function isEmpty(box: Box): boolean {
  return !(box.maxX >= box.minX) || !(box.maxZ >= box.minZ)
}

function roundBox(box: Box): GcodeExtents {
  return {
    minX: round(box.minX, 3),
    minY: round(box.minY, 3),
    minZ: round(box.minZ, 3),
    maxX: round(box.maxX, 3),
    maxY: round(box.maxY, 3),
    maxZ: round(box.maxZ, 3),
  }
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
