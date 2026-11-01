import { describe, expect, it, vi } from 'vitest'
import { gcodePaints, planSlots, readKxSlots, startOnKxBridge, type GcodePaint } from './kx-bridge'
import { sendToPrinter, type PrintHostConfig } from './print-hosts'
import type { FilamentSlot } from './printer-status'

/**
 * KX-Bridge's own print start: which slot each tool goes to, and the two
 * requests that start it there without the bridge asking in its web page.
 */

const kx: PrintHostConfig = {
  id: 'h1',
  name: 'Kobra X',
  protocol: 'kx-bridge',
  endpoint: 'http://kx.local:7125',
  apiKey: null,
}

const encode = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: unknown, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const slot = (
  index: number,
  material: string,
  colorHex: string,
  extra: Partial<FilamentSlot> = {},
) => ({ index, loaded: true, active: false, material, colorHex, ...extra }) satisfies FilamentSlot

const empty = (index: number): FilamentSlot => ({ index, loaded: false, active: false })

const paint = (n: number, material: string, colorHex: string, used = true): GcodePaint => ({
  paint: n,
  material,
  colorHex,
  used,
})

const threePla = [slot(0, 'PLA', '#ffffff'), slot(1, 'PLA', '#d01010'), slot(2, 'PLA', '#1020e0')]

describe('reading the G-code', () => {
  it('reads colours and materials per tool, and which tools are used', () => {
    const paints = gcodePaints(
      encode(
        [
          '; filament_colour = #FF0000;#00FF00;#0000FF',
          '; filament_type = PLA;PETG;PLA',
          'G28',
          'T0',
          'G1 X1',
          'T2',
          'G1 X2',
        ].join('\n'),
      ),
    )
    expect(paints).toEqual([
      { paint: 0, colorHex: '#ff0000', material: 'PLA', used: true },
      { paint: 1, colorHex: '#00ff00', material: 'PETG', used: false },
      { paint: 2, colorHex: '#0000ff', material: 'PLA', used: true },
    ])
  })

  it("falls back to the header's 1-based tool list when the body has no tool change", () => {
    const paints = gcodePaints(
      encode(
        '; filament_colour = #111111;#222222\n; filament_type = PLA;PLA\n; filament: 2\nG28\n',
      ),
    )
    expect(paints.map((p) => p.used)).toEqual([false, true])
  })

  it('counts every tool as used when nothing says otherwise, and reads quoted values', () => {
    const paints = gcodePaints(encode('; filament_type = "PLA"\n; filament_colour = "#ABCDEF"\n'))
    expect(paints).toEqual([{ paint: 0, colorHex: '#abcdef', material: 'PLA', used: true }])
  })

  it('finds nothing in a file without the slicer header', () => {
    expect(gcodePaints(encode('G28\nG1 X0\n'))).toEqual([])
  })
})

describe('choosing slots', () => {
  it('asks when the file names only a material and several slots hold it', () => {
    // The case that prompted this: three PLAs, sliced with the default white.
    const plan = planSlots([paint(0, 'PLA', '#f2f2f2')], threePla)
    expect(plan.sure).toBe(true)
    expect(plan.paints[0]!.slot).toBe(0)

    const unsure = planSlots([paint(0, 'PLA', '#808080')], threePla)
    expect(unsure.sure).toBe(false)
  })

  it('places a tool by its colour when one slot is that colour', () => {
    const plan = planSlots([paint(0, 'PLA', '#c00000')], threePla)
    expect(plan).toMatchObject({ sure: true, paints: [{ slot: 1, sure: true }] })
  })

  it("follows the request's colour over what the file was sliced with", () => {
    const plan = planSlots([paint(0, 'PLA', '#ffffff')], threePla, {
      material: 'PLA',
      colorHex: '#0000ff',
      spoolmanSpoolId: null,
    })
    expect(plan).toMatchObject({ sure: true, paints: [{ slot: 2 }] })
  })

  it("follows the request's Spoolman spool over its colour", () => {
    const slots = [
      slot(0, 'PLA', '#d01010', { spoolmanSpoolId: 7 }),
      slot(1, 'PLA', '#d01010', { spoolmanSpoolId: 9 }),
    ]
    const plan = planSlots([paint(0, 'PLA', '#ffffff')], slots, {
      material: 'PLA',
      colorHex: '#ff0000',
      spoolmanSpoolId: 9,
    })
    expect(plan).toMatchObject({ sure: true, paints: [{ slot: 1 }] })
  })

  it('asks, with a guess, when what the request wants is not loaded', () => {
    const plan = planSlots([paint(0, 'PLA', '#d01010')], threePla, {
      material: 'PLA',
      colorHex: '#00ff00',
      spoolmanSpoolId: null,
    })
    expect(plan.sure).toBe(false)
    // The file's colour is the best fallback for someone to confirm.
    expect(plan.paints[0]!.slot).toBe(1)
  })

  it('treats near-identical spools as one answer', () => {
    const slots = [slot(0, 'PLA', '#101010'), slot(1, 'PLA', '#151515'), slot(2, 'PETG', '#ffffff')]
    expect(planSlots([paint(0, 'PLA', '#000000')], slots)).toMatchObject({
      sure: true,
      paints: [{ slot: 0 }],
    })
  })

  it('never puts a PLA tool on a PETG slot when guessing by colour', () => {
    const slots = [slot(0, 'PETG', '#ff0000'), slot(1, 'PLA', '#0000ff')]
    const plan = planSlots([paint(0, 'PLA', '#ff0000')], slots)
    expect(plan.sure).toBe(false)
    expect(plan.paints[0]!.slot).toBe(1)
  })

  it('places each tool of a multi-colour print on its own slot', () => {
    const plan = planSlots(
      [paint(0, 'PLA', '#0000ff'), paint(1, 'PLA', '#ff0000', false), paint(2, 'PLA', '#ffffff')],
      threePla,
    )
    expect(plan.sure).toBe(true)
    expect(plan.paints.map((p) => [p.paint, p.slot])).toEqual([
      [0, 2],
      [2, 0],
    ])
  })

  it('does not hand two tools the same slot', () => {
    const plan = planSlots(
      [paint(0, 'PLA', '#ff0000'), paint(1, 'PLA', '#ee0000')],
      [slot(0, 'PLA', '#ff0000'), slot(1, 'PLA', '#00ff00')],
    )
    expect(plan.paints.map((p) => p.slot)).toEqual([0, 1])
    expect(plan.sure).toBe(false)
  })

  it('is sure of the only loaded slot, even for a file that says nothing', () => {
    expect(planSlots([], [empty(0), slot(1, 'PLA', '#ff0000')])).toMatchObject({
      sure: true,
      paints: [{ paint: 0, slot: 1 }],
    })
    expect(planSlots([], threePla).sure).toBe(false)
  })

  it('is never sure with nothing loaded', () => {
    expect(planSlots([paint(0, 'PLA', '#ffffff')], [empty(0), empty(1)])).toMatchObject({
      sure: false,
      paints: [{ slot: null }],
    })
  })
})

describe('talking to the bridge', () => {
  it('reads the slots with their bridge numbers and Spoolman spools', async () => {
    const fetchImpl = stub((url) => {
      if (url.endsWith('/kx/filament/slots')) {
        return json({
          result: [
            { slot_index: 1, status: 'empty', material: '', color_hex: '#000000' },
            {
              slot_index: 0,
              status: 'loaded',
              material: 'PLA',
              color_hex: '#FF0000',
              filament_name: 'Anycubic PLA',
            },
            {
              slot_index: 2,
              status: 'loaded',
              material: 'PETG',
              color_hex: '#00FF00',
              filament_name: '',
            },
          ],
        })
      }
      return json({ result: { status: { mmu: { gate_spool_id: [12, -1, 4] } } } })
    })
    expect(await readKxSlots(kx, fetchImpl)).toEqual([
      {
        index: 0,
        loaded: true,
        active: false,
        material: 'PLA',
        colorHex: '#ff0000',
        name: 'Anycubic PLA',
        spoolmanSpoolId: 12,
      },
      { index: 1, loaded: false, active: false },
      {
        index: 2,
        loaded: true,
        active: false,
        material: 'PETG',
        colorHex: '#00ff00',
        spoolmanSpoolId: 4,
      },
    ])
  })

  it('uploads without starting, then starts with every tool on its slot', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = stub((url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/server/files/upload')) {
        return json({ files: { local: { name: 'cube.gcode', path: 'cube.gcode' } } }, 201)
      }
      return json({ result: 'ok' })
    })
    const result = await startOnKxBridge(
      kx,
      { filename: 'cube.gcode', data: encode('G28') },
      [paint(0, 'PLA', '#ff0000'), paint(1, 'PLA', '#00ff00', false)],
      [{ paint: 0, slot: 2 }],
      threePla,
      fetchImpl,
    )
    expect(result).toEqual({ ok: true, remotePath: 'cube.gcode' })
    expect(calls.map((c) => c.url)).toEqual([
      'http://kx.local:7125/server/files/upload',
      'http://kx.local:7125/printer/print/start',
    ])
    expect((calls[0]!.init!.body as FormData).get('print')).toBe('false')
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({
      filename: 'cube.gcode',
      filament_assignments: [
        {
          paint_index: 0,
          slot_index: 2,
          is_used: true,
          paint_color: [255, 0, 0, 255],
          material: 'PLA',
        },
        { paint_index: 1, slot_index: -1, is_used: false },
      ],
    })
  })

  it('does not start when the upload fails', async () => {
    const fetchImpl = stub(() => new Response('nope', { status: 400 }))
    const result = await startOnKxBridge(
      kx,
      { filename: 'cube.gcode', data: encode('G28') },
      [],
      [{ paint: 0, slot: 0 }],
      threePla,
      fetchImpl,
    )
    expect(result.ok).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('says so when the printer never confirms the start', async () => {
    const fetchImpl = stub((url) =>
      url.endsWith('/upload') ? json({}, 201) : json({ error: 'no response from printer' }, 504),
    )
    const result = await startOnKxBridge(
      kx,
      { filename: 'cube.gcode', data: encode('G28') },
      [],
      [{ paint: 0, slot: 0 }],
      threePla,
      fetchImpl,
    )
    expect(result).toEqual({
      ok: false,
      error: 'Kobra X has the file but did not confirm the start.',
    })
  })

  it('is plain Moonraker for an upload that does not start', async () => {
    const fetchImpl = stub(() => json({}, 201))
    await sendToPrinter(kx, { filename: 'cube.gcode', data: encode('G28') }, {}, fetchImpl)
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('http://kx.local:7125/server/files/upload')
    expect((init.body as FormData).get('print')).toBe('false')
  })
})
