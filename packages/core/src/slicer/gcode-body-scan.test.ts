import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { TOOL_CHANGE_LIMIT, scanGcodeBody, scanGcodeBodyStream } from './gcode-body-scan'

// Small hand-written bodies in each slicer's shape; see gcode-metadata.test.ts.

const PRUSA_BODY = `M73 P0 R60
M73 Q0 S66
G90
M83
G28
G1 Z5 F720
; purge line, before the first layer, which is not the print
G1 X0 Y-3 E8 F1000
T0
;LAYER_CHANGE
;Z:0.2
;HEIGHT:0.2
M73 P10 R54
; printing object Box id:0 copy 0
G1 X10 Y10 Z0.2 F7200
G1 X50 Y10 E2.5
G1 X50 Y40 E2
; stop printing object Box id:0 copy 0
; printing object Box id:0 copy 1
G1 X60 Y10
G1 X90 Y10 E2
;LAYER_CHANGE
;Z:0.4
;HEIGHT:0.2
M73 P50 R30
;COLOR_CHANGE,T0,#FF8000
M600
G1 X10 Y10 Z0.4
G1 X90 Y45 E3
;LAYER_CHANGE
;Z:0.6
M73 P80 R12
;PAUSE_PRINT
M601
G1 X10 Y10 Z0.6
G1 X20 Y20 E1
; objects_info = {"objects":[{"name":"Box id:0 copy 0","polygon":[[0,0]]},{"name":"Box id:0 copy 1","polygon":[[0,0]]}]}
M73 P100 R0
G1 Z20 F600 ; lift
`

describe('scanGcodeBody', () => {
  it('reads layers, pauses with their place in the print, extents and objects', () => {
    const scan = scanGcodeBody(PRUSA_BODY)
    expect(scan.layerCount).toBe(3)
    expect(scan.maxZMm).toBe(0.6)
    // The purge line at Y-3 is before the first layer, so it is not counted.
    expect(scan.extents).toEqual({ minX: 10, minY: 10, minZ: 0.2, maxX: 90, maxY: 45, maxZ: 0.6 })
    expect(scan.pauses).toEqual([
      {
        kind: 'filament_change',
        command: 'M600',
        colorHex: '#ff8000',
        tool: 0,
        layer: 2,
        zMm: 0.4,
        elapsedMin: 30,
        progressPercent: 50,
      },
      {
        kind: 'pause',
        command: 'M601',
        colorHex: null,
        tool: 0,
        layer: 3,
        zMm: 0.6,
        elapsedMin: 48,
        progressPercent: 80,
      },
    ])
    expect(scan.progressTotalMin).toBe(60)
    // objects_info and the comments agree; the JSON wins and nothing is doubled.
    expect(scan.objects).toEqual(['Box id:0 copy 0', 'Box id:0 copy 1'])
    expect(scan.objectCount).toBe(2)
    expect(scan.usedTools).toEqual([0])
    expect(scan.toolChanges).toBe(0)
  })

  it('counts tool changes and the purge each tool puts into the tower', () => {
    const scan = scanGcodeBody(`M82
G92 E0
T0
;LAYER_CHANGE
;Z:0.2
G1 X10 Y10 Z0.2
G1 X20 Y10 E1
T1
;TYPE:Wipe tower
G1 X200 Y200 E3
G1 X210 Y200 E5
;TYPE:Perimeter
G1 X30 Y10 E6
;LAYER_CHANGE
;Z:0.4
T0
;TYPE:Wipe tower
G92 E0
G1 X200 Y200 Z0.4 E1.5
;TYPE:Outer wall
T0
T255
`)
    expect(scan.toolChanges).toBe(2)
    expect(scan.toolChangeTimeline).toEqual([
      { from: 0, to: 1, layer: 1, zMm: 0.2, elapsedMin: null, progressPercent: null },
      { from: 1, to: 0, layer: 2, zMm: 0.4, elapsedMin: null, progressPercent: null },
    ])
    // Every T counts as used, sentinels included, as scanUsedTools does.
    expect(scan.usedTools).toEqual([0, 1, 255])
    expect(scan.purgeMm).toEqual([
      { tool: 0, mm: 1.5 },
      { tool: 1, mm: 4 },
    ])
  })

  it('treats Bambu flushes as purge but not as print area', () => {
    const scan = scanGcodeBody(`M83
T0
; CHANGE_LAYER
; Z_HEIGHT: 0.2
G1 X10 Y10 Z0.2
G1 X20 Y20 E1
M620 S1A
T1
; FLUSH_START
G1 E20 F300
G1 X-40 Y250 E5
; FLUSH_END
M621 S1A
M400 U1
G1 X25 Y25
G1 X30 Y30 E1
`)
    expect(scan.purgeMm).toEqual([{ tool: 1, mm: 25 }])
    expect(scan.extents).toEqual({ minX: 10, minY: 10, minZ: 0.2, maxX: 30, maxY: 30, maxZ: 0.2 })
    expect(scan.pauses.map((pause) => pause.command)).toEqual(['M400 U1'])
    expect(scan.layerCount).toBe(1)
  })

  it('counts layers once when a file writes two marker families', () => {
    const body = Array.from(
      { length: 4 },
      (_, i) => `;LAYER_CHANGE\nSET_PRINT_STATS_INFO CURRENT_LAYER=${i + 1}\nG1 X1 Y1 Z${i + 1} E1`,
    ).join('\n')
    expect(scanGcodeBody(`M83\n${body}`).layerCount).toBe(4)
  })

  it('falls back to extrusion heights for layers, and to all extrusion for extents', () => {
    const scan = scanGcodeBody(`G90
M83
G1 X0 Y0 Z0.3
G1 X10 Y0 E1
G1 Z0.6
G1 X0 Y5 E1
G1 Z0.9
G1 X5 Y5
`)
    expect(scan.layerCount).toBe(2)
    expect(scan.extents).toEqual({ minX: 0, minY: 0, minZ: 0.3, maxX: 10, maxY: 5, maxZ: 0.6 })
  })

  it('follows relative positioning', () => {
    const scan = scanGcodeBody(`M83
G1 X10 Y10 Z0.2
;LAYER_CHANGE
G91
G1 X5 Y5 E1
G1 X5 E1
`)
    expect(scan.extents).toEqual({ minX: 10, minY: 10, minZ: 0.2, maxX: 20, maxY: 15, maxZ: 0.2 })
  })

  it('reads Cura layers, meshes and pauses', () => {
    const scan = scanGcodeBody(`;LAYER_COUNT:2
;LAYER:-1
;MESH:NONMESH
G0 X1 Y1 Z0.3
;MESH:Part.stl
G1 X5 Y5 E1
;LAYER:0
;MESH:Part.stl
G1 X6 Y6 Z0.5 E2
M25 ; pause at height
`)
    expect(scan.layerCount).toBe(2)
    expect(scan.objects).toEqual(['Part.stl'])
    expect(scan.pauses).toMatchObject([{ kind: 'pause', command: 'M25', layer: 2 }])
  })

  it('prefers Klipper object definitions over comments naming the same objects', () => {
    const scan = scanGcodeBody(`EXCLUDE_OBJECT_DEFINE NAME=Cube_stl_id_3_copy_0 CENTER=10,10
EXCLUDE_OBJECT_DEFINE NAME=Cube_stl_id_3_copy_1 CENTER=30,10
; printing object Cube.stl id:3 copy 0
; printing object Cube.stl id:3 copy 1
PAUSE
`)
    expect(scan.objects).toEqual(['Cube_stl_id_3_copy_0', 'Cube_stl_id_3_copy_1'])
    expect(scan.pauses).toMatchObject([{ command: 'PAUSE' }])
  })

  it('counts M486 objects by id when they are not named', () => {
    const scan = scanGcodeBody(`M486 T3
M486 S0
M486 S1
M486 S-1
M486 S2
M486 S1
`)
    expect(scan.objects).toEqual([])
    expect(scan.objectCount).toBe(3)
  })

  it('reports nothing it could not establish', () => {
    expect(scanGcodeBody('; just a comment\nM104 S200\n')).toEqual({
      layerCount: null,
      maxZMm: null,
      extents: null,
      usedTools: [],
      toolChanges: 0,
      toolChangeTimeline: [],
      pauses: [],
      objects: [],
      objectCount: null,
      purgeMm: [],
      progressTotalMin: null,
    })
  })

  it('keeps the count of tool changes past the timeline limit', () => {
    const body = Array.from({ length: TOOL_CHANGE_LIMIT + 10 }, (_, i) => `T${i % 2}`).join('\n')
    const scan = scanGcodeBody(body)
    expect(scan.toolChanges).toBe(TOOL_CHANGE_LIMIT + 9)
    expect(scan.toolChangeTimeline).toHaveLength(TOOL_CHANGE_LIMIT)
  })
})

describe('scanGcodeBodyStream', () => {
  it('reads commands split across chunks', async () => {
    const text = PRUSA_BODY
    const chunks: Buffer[] = []
    for (let i = 0; i < text.length; i += 7) chunks.push(Buffer.from(text.slice(i, i + 7)))
    expect(await scanGcodeBodyStream(Readable.from(chunks))).toEqual(scanGcodeBody(text))
  })
})
