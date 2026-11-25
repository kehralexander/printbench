import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSpoolmanCache, type SpoolmanSpool } from '../spoolman/spoolman'
import { printerMaterial, profileForSpool, readKxSpoolMap } from './kx-bridge-spools'
import type { PrintHostConfig } from './print-hosts'
import type { PrinterStatus } from './printer-status'
import { changeSpool } from './spool-change'

const kx: PrintHostConfig = {
  id: 'h1',
  name: 'Kobra X',
  protocol: 'kx-bridge',
  endpoint: 'http://kx.local:7125',
  apiKey: null,
}

const idle: PrinterStatus = { state: 'idle', busy: false }

const spool = (id: number, extra: Partial<SpoolmanSpool> = {}): SpoolmanSpool => ({
  id,
  filamentId: id,
  filamentName: 'Matte White',
  vendor: 'Anycubic',
  material: 'PLA',
  colorHex: '#f1f0ed',
  remainingG: 1000,
  initialG: 1000,
  price: null,
  costPerGram: null,
  location: 'Storage',
  comment: null,
  archived: false,
  lastUsed: null,
  ...extra,
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * A KX-Bridge (stable routes unless `plugin`) and a Spoolman in one fetch,
 * keeping what was written so the test can look at it.
 */
function world(options: { map?: Record<string, number>; plugin?: boolean; refuse?: boolean } = {}) {
  let map: Record<string, number> = { ...(options.map ?? {}) }
  const slots = [0, 1, 2, 3].map((i) => ({
    slot_index: i,
    material: 'PLA Matte',
    color_hex: '#F1F0ED',
    status: 'loaded',
  }))
  const calls: { method: string; path: string; body?: unknown }[] = []
  const spoolman = new Map<number, string>()
  const route = options.plugin ? '/kx/plugin/spoolman' : '/kx/spoolman'

  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: url.pathname + url.search, body })

    if (url.host === 'spoolman.test') {
      const id = Number(url.pathname.split('/').pop())
      spoolman.set(id, body.location)
      return json({ id, location: body.location })
    }
    switch (`${method} ${url.pathname}`) {
      case `GET ${route}/status`:
        return json({ configured: true, reachable: true, slot_spools: map })
      case `POST ${route}/active-spool`:
        map = body.slot_map
        return json({ slot_spools: map })
      case 'POST /api/ams/set_slot':
        if (!options.refuse) {
          slots[body.index]!.material = body.type
          slots[body.index]!.color_hex =
            '#' + body.color.map((c: number) => c.toString(16).padStart(2, '0')).join('')
        }
        return json({ result: 'ok' })
      case 'GET /kx/filament/profiles':
        return json({
          result: [
            { vendor: 'Anycubic', name: 'Anycubic PLA', type: 'PLA' },
            { vendor: 'Anycubic', name: 'Anycubic PLA Matte', type: 'PLA' },
            { vendor: 'Anycubic', name: 'Anycubic PLA Silk', type: 'PLA' },
            { vendor: 'Elegoo', name: 'Elegoo PLA', type: 'PLA' },
          ],
        })
      case 'GET /kx/filament/slots':
        return json({ result: slots })
      case 'GET /printer/objects/query':
        return json({ result: { status: { mmu: { gate_spool_id: [] } } } })
      default:
        if (method === 'POST' && url.pathname.startsWith('/kx/filament/slots/')) {
          return json({ result: 'ok' })
        }
        // What the bridge does with a path it does not know.
        return json({ result: {} })
    }
  }) as unknown as typeof fetch

  return { fetchImpl, calls, map: () => map, spoolman, slots }
}

const deps = (fetchImpl: typeof fetch, spools: SpoolmanSpool[] = []) => ({
  fetch: fetchImpl,
  readStatus: async () => idle,
  sleep: async () => {},
  spools,
})

describe('changing a spool', () => {
  beforeEach(() => {
    process.env.SPOOLMAN_URL = 'http://spoolman.test'
    clearSpoolmanCache()
  })
  afterEach(() => {
    delete process.env.SPOOLMAN_URL
  })

  it('tells the printer, the bridge and Spoolman', async () => {
    const w = world({ map: { '0': 11, '1': 10 } })
    const result = await changeSpool(
      kx,
      { slotIndex: 0, spool: spool(9, { colorHex: '#f1f0ed' }), returnLocation: 'Storage' },
      deps(w.fetchImpl, [spool(11, { location: 'Kobra X' })]),
    )

    expect(result).toMatchObject({ ok: true, previousSpoolId: 11, movedFromSlot: null })
    expect(w.map()).toEqual({ '0': 9, '1': 10 })
    expect(w.calls).toContainEqual({
      method: 'POST',
      path: '/api/ams/set_slot',
      body: { index: 0, type: 'PLA Matte', color: [241, 240, 237] },
    })
    expect(w.calls).toContainEqual({
      method: 'POST',
      path: '/kx/filament/slots/0/profile',
      body: { vendor: 'Anycubic', name: 'Anycubic PLA Matte' },
    })
    expect(w.spoolman.get(9)).toBe('Kobra X')
    expect(w.spoolman.get(11)).toBe('Storage')
    expect('steps' in result && result.steps.map((s) => [s.key, s.status])).toEqual([
      ['printer', 'done'],
      ['profile', 'done'],
      ['binding', 'done'],
      ['spool-in', 'done'],
      ['spool-out', 'done'],
      ['confirm', 'done'],
    ])
  })

  it('moves a spool from another slot rather than binding it twice', async () => {
    const w = world({ map: { '0': 11, '2': 87 } })
    const result = await changeSpool(
      kx,
      {
        slotIndex: 0,
        spool: spool(87, { location: 'Kobra X', colorHex: '#74cdc7' }),
        returnLocation: 'Storage',
      },
      deps(w.fetchImpl),
    )
    expect(result).toMatchObject({ ok: true, movedFromSlot: 2, previousSpoolId: 11 })
    expect(w.map()).toEqual({ '0': 87 })
    // Already in the printer: no write for it.
    expect(w.spoolman.has(87)).toBe(false)
  })

  it('unbinds a slot left empty and sends its spool back', async () => {
    const w = world({ map: { '0': 11, '3': 17 } })
    const result = await changeSpool(
      kx,
      { slotIndex: 3, spool: null, returnLocation: 'Shelf B' },
      deps(w.fetchImpl),
    )
    expect(result).toMatchObject({ ok: true, previousSpoolId: 17 })
    expect(w.map()).toEqual({ '0': 11 })
    expect(w.spoolman.get(17)).toBe('Shelf B')
    expect(w.calls.some((c) => c.path === '/api/ams/set_slot')).toBe(false)
    expect(w.calls).toContainEqual({
      method: 'POST',
      path: '/kx/filament/slots/3/profile',
      body: { vendor: '', name: '' },
    })
  })

  it('does not rewrite bindings that are already right', async () => {
    // Rewriting resets the bridge's usage counters for every slot.
    const w = world({ map: { '0': 9 } })
    await changeSpool(
      kx,
      { slotIndex: 0, spool: spool(9, { location: 'Kobra X' }), returnLocation: 'Storage' },
      deps(w.fetchImpl),
    )
    expect(w.calls.some((c) => c.path.endsWith('/active-spool'))).toBe(false)
  })

  it('says so when the printer does not take the colour', async () => {
    const w = world({ map: {}, refuse: true })
    const result = await changeSpool(
      kx,
      { slotIndex: 1, spool: spool(17, { colorHex: '#2d3f6f' }), returnLocation: 'Storage' },
      deps(w.fetchImpl),
    )
    // Sent and bound; only the printer's word is missing.
    expect(result).toMatchObject({ ok: true })
    expect('steps' in result && result.steps.at(-1)).toMatchObject({
      key: 'confirm',
      status: 'unconfirmed',
    })
  })

  it('refuses while printing, before writing anything', async () => {
    const w = world({ map: { '0': 11 } })
    const result = await changeSpool(
      kx,
      { slotIndex: 0, spool: spool(9), returnLocation: 'Storage' },
      { ...deps(w.fetchImpl), readStatus: async () => ({ state: 'printing', busy: true }) },
    )
    expect(result).toMatchObject({ ok: false, refused: expect.stringMatching(/printing/) })
    expect(w.calls).toHaveLength(0)
  })

  it('refuses an archived spool', async () => {
    const w = world()
    const result = await changeSpool(
      kx,
      { slotIndex: 0, spool: spool(9, { archived: true }), returnLocation: 'Storage' },
      deps(w.fetchImpl),
    )
    expect(result).toMatchObject({ ok: false, refused: expect.stringMatching(/archived/) })
  })
})

describe('the bridge spool map', () => {
  it('falls back to the plugin routes of a nightly bridge', async () => {
    const w = world({ map: { '1': 10 }, plugin: true })
    const read = await readKxSpoolMap(kx, w.fetchImpl)
    expect(read).toMatchObject({ ok: true, route: '/kx/plugin/spoolman' })
    expect(read.ok && [...read.map]).toEqual([[1, 10]])
  })

  it('says so when the bridge has no Spoolman', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ configured: false, slot_spools: {} }),
    ) as unknown as typeof fetch
    expect(await readKxSpoolMap(kx, fetchImpl)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no Spoolman/),
    })
  })
})

describe('what the printer and slicer are told', () => {
  it('adds the finish the filament name carries', () => {
    expect(printerMaterial({ material: 'PLA', filamentName: 'Matte Navy Blue' })).toBe('PLA Matte')
    expect(printerMaterial({ material: 'PLA Matte', filamentName: 'Matte White' })).toBe(
      'PLA Matte',
    )
    expect(printerMaterial({ material: 'PETG', filamentName: 'Basic Yellow' })).toBe('PETG')
  })

  it('picks the vendor profile with the variant the spool names', () => {
    const profiles = [
      { vendor: 'Elegoo', name: 'Elegoo PLA', type: 'PLA' },
      { vendor: 'Elegoo', name: 'Elegoo Rapid PLA+', type: 'PLA' },
      { vendor: 'Anycubic', name: 'Anycubic PLA Silk', type: 'PLA' },
    ]
    expect(
      profileForSpool(
        { vendor: 'ELEGOO', material: 'PLA', filamentName: 'Matte Navy Blue' },
        profiles,
      ),
    ).toMatchObject({ name: 'Elegoo PLA' })
    expect(
      profileForSpool({ vendor: 'Sunlu', material: 'PLA', filamentName: 'White' }, profiles),
    ).toBeNull()
  })
})
