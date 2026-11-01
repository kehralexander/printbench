import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSpoolmanCache,
  listSpoolmanSpools,
  spoolmanEnabled,
  spoolmanSpoolLink,
} from './spoolman'

const SPOOL = {
  id: 17,
  filament: {
    id: 12,
    name: 'Matte Navy Blue',
    vendor: { id: 2, name: 'ELEGOO' },
    material: 'PLA',
    weight: 1000,
    color_hex: '2D3F6F',
  },
  remaining_weight: 894.35,
  initial_weight: 1000,
  location: 'Kobra X',
  archived: false,
  last_used: '2026-10-27T17:41:37Z',
}

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('Spoolman client', () => {
  beforeEach(() => {
    process.env.SPOOLMAN_URL = 'https://spoolman.example.test/'
    clearSpoolmanCache()
  })
  afterEach(() => {
    delete process.env.SPOOLMAN_URL
    clearSpoolmanCache()
  })

  it('is off without SPOOLMAN_URL', async () => {
    delete process.env.SPOOLMAN_URL
    expect(spoolmanEnabled()).toBe(false)
    expect(await listSpoolmanSpools({ fetch: respond([]) })).toMatchObject({ ok: false })
  })

  it('reads spools, including archived ones, from the API', async () => {
    const fetch = respond([SPOOL])
    const result = await listSpoolmanSpools({ fetch })
    expect(fetch).toHaveBeenCalledWith(
      'https://spoolman.example.test/api/v1/spool?allow_archived=true',
      expect.anything(),
    )
    expect(result).toEqual({
      ok: true,
      spools: [
        {
          id: 17,
          filamentId: 12,
          filamentName: 'Matte Navy Blue',
          vendor: 'ELEGOO',
          material: 'PLA',
          colorHex: '#2d3f6f',
          remainingG: 894.35,
          initialG: 1000,
          location: 'Kobra X',
          comment: null,
          archived: false,
          lastUsed: '2026-10-27T17:41:37Z',
        },
      ],
    })
  })

  it('drops the alpha channel and falls back to multi-colour hexes', async () => {
    const result = await listSpoolmanSpools({
      fetch: respond([
        { ...SPOOL, id: 1, filament: { ...SPOOL.filament, color_hex: '00FFFFFF' } },
        {
          ...SPOOL,
          id: 2,
          filament: { ...SPOOL.filament, color_hex: null, multi_color_hexes: 'FF0000,00FF00' },
        },
        { ...SPOOL, id: 3, filament: { ...SPOOL.filament, color_hex: 'not a colour' } },
      ]),
    })
    expect(result.ok && result.spools.map((s) => s.colorHex)).toEqual(['#00ffff', '#ff0000', null])
  })

  it('caches for a minute', async () => {
    const fetch = respond([SPOOL])
    await listSpoolmanSpools({ fetch, now: 1_000 })
    await listSpoolmanSpools({ fetch, now: 50_000 })
    expect(fetch).toHaveBeenCalledTimes(1)
    await listSpoolmanSpools({ fetch, now: 70_000 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('fails soft when Spoolman is down or answers badly', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await listSpoolmanSpools({ fetch: down })).toEqual({
      ok: false,
      error: 'Spoolman could not be reached.',
    })
    clearSpoolmanCache()
    expect(await listSpoolmanSpools({ fetch: respond({}, 500) })).toEqual({
      ok: false,
      error: 'Spoolman answered 500.',
    })
  })

  it('links to the spool in Spoolman', () => {
    expect(spoolmanSpoolLink(17)).toBe('https://spoolman.example.test/spool/show/17')
  })
})
