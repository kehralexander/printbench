import { describe, expect, it } from 'vitest'
import type { FilamentSlot } from './printer-status'
import {
  describeFilament,
  describeFilaments,
  loadNextHints,
  spoolForecast,
  type ForecastRequest,
} from './queue-planning'

const slot = (index: number, extra: Partial<FilamentSlot> = {}): FilamentSlot => ({
  index,
  loaded: true,
  active: false,
  ...extra,
})

const kobra = {
  id: 'p1',
  name: 'Kobra X',
  slots: [
    slot(0, { material: 'PLA', colorHex: '#ffffff', spoolmanSpoolId: 12 }),
    slot(1, { material: 'PLA', colorHex: '#17223b', spoolmanSpoolId: 17 }),
  ],
}

type Wish = { material?: string | null; colorHex?: string | null; spoolmanSpoolId?: number | null }

const request = (id: string, wish: Wish = {}, more: Wish[] = [], held = false) => ({
  id,
  title: id,
  held,
  filaments: [wish, ...more].map((filament) => ({
    material: null,
    colorHex: null,
    spoolmanSpoolId: null,
    ...filament,
  })),
})

describe('what an idle printer should print next', () => {
  it('suggests the head of the queue when its filament is loaded', () => {
    const [hint] = loadNextHints([kobra], [request('a', { spoolmanSpoolId: 17 }), request('b')])
    expect(hint).toMatchObject({ ready: { request: { id: 'a' }, slot: { index: 1 } }, swap: null })
  })

  it('skips to one that is loaded, and says what to swap in for the urgent one', () => {
    const [hint] = loadNextHints(
      [kobra],
      [
        request('red', { material: 'PETG', colorHex: '#ff0000', spoolmanSpoolId: 21 }),
        request('white', { spoolmanSpoolId: 12 }),
      ],
    )
    expect(hint?.ready).toMatchObject({ request: { id: 'white' }, slot: { index: 0 } })
    expect(hint?.swap).toEqual({
      request: expect.objectContaining({ id: 'red' }),
      filament: 'spool #21 · PETG',
    })
  })

  it('treats a request with no filament wish as printable on anything', () => {
    const [hint] = loadNextHints([kobra], [request('red', { spoolmanSpoolId: 21 }), request('any')])
    expect(hint?.ready?.request.id).toBe('any')
  })

  it('has nothing ready when no request fits, but still names the swap', () => {
    const [hint] = loadNextHints(
      [kobra],
      [request('red', { material: 'PETG', colorHex: '#ff0000' })],
    )
    expect(hint).toMatchObject({ ready: null, swap: { filament: 'PETG #ff0000' } })
  })

  it('simply takes the head of the queue on a printer without slot data', () => {
    const [hint] = loadNextHints(
      [{ id: 'p2', name: 'Mini', slots: [] }],
      [request('red', { material: 'PETG' })],
    )
    expect(hint).toMatchObject({ ready: { request: { id: 'red' }, slot: null }, swap: null })
    expect(loadNextHints([kobra], [])).toEqual([])
    expect(describeFilament({ material: null, colorHex: null, spoolmanSpoolId: null })).toBe(
      'its filament',
    )
  })

  it('is ready only when every filament of a request is loaded, and names the missing one', () => {
    const [hint] = loadNextHints(
      [kobra],
      [
        request('two-colour', { spoolmanSpoolId: 12 }, [{ material: 'PETG', colorHex: '#ff0000' }]),
        request('white', { spoolmanSpoolId: 12 }),
      ],
    )
    expect(hint?.ready?.request.id).toBe('white')
    expect(hint?.swap).toMatchObject({ request: { id: 'two-colour' }, filament: 'PETG #ff0000' })
  })

  it('passes over requests held for their requester', () => {
    const [hint] = loadNextHints([kobra], [request('quoted', {}, [], true), request('accepted')])
    expect(hint).toMatchObject({ ready: { request: { id: 'accepted' } }, swap: null })
  })

  it('names several missing filaments together', () => {
    expect(
      describeFilaments([
        { material: 'PLA', colorHex: '#ff0000', spoolmanSpoolId: null },
        { material: null, colorHex: null, spoolmanSpoolId: null },
        { material: 'PETG', colorHex: null, spoolmanSpoolId: 4 },
      ]),
    ).toBe('PLA #ff0000 and spool #4 · PETG')
  })
})

const queued = (id: string, extra: Partial<ForecastRequest> = {}): ForecastRequest => ({
  id,
  title: id,
  status: 'requested',
  filaments: [{ spoolmanSpoolId: 17, grams: 100 }],
  left: 1,
  progress: null,
  ...extra,
})

describe('spool burn-down', () => {
  it('says after how many of the queued prints a spool runs out', () => {
    const [spool] = spoolForecast(
      [queued('a', { left: 2 }), queued('b'), queued('c')],
      new Map([[17, 250]]),
    )
    expect(spool).toEqual({
      spoolId: 17,
      remainingG: 250,
      neededG: 400,
      prints: 4,
      runsOutAfter: 2,
      shortRequestIds: ['b', 'c'],
    })
  })

  it('counts only what the running print still needs, and it first', () => {
    const [spool] = spoolForecast(
      [queued('next'), queued('running', { status: 'printing', progress: 0.75 })],
      new Map([[17, 130]]),
    )
    expect(spool).toMatchObject({ neededG: 125, runsOutAfter: null, shortRequestIds: [] })
  })

  it('leaves out what it cannot count', () => {
    expect(
      spoolForecast(
        [
          queued('a', { filaments: [{ spoolmanSpoolId: 17, grams: null }] }),
          queued('b', { filaments: [{ spoolmanSpoolId: null, grams: 100 }] }),
          queued('c', { filaments: [{ spoolmanSpoolId: 99, grams: 100 }] }),
        ],
        new Map([[17, 10]]),
      ),
    ).toEqual([])
  })

  it('sums the grams of every filament per spool', () => {
    const forecast = spoolForecast(
      [
        queued('two-colour', {
          left: 2,
          filaments: [
            { spoolmanSpoolId: 17, grams: 30 },
            { spoolmanSpoolId: 21, grams: 5 },
            { spoolmanSpoolId: 17, grams: 10 },
          ],
        }),
      ],
      new Map([
        [17, 1000],
        [21, 8],
      ]),
    )
    expect(forecast).toEqual([
      expect.objectContaining({ spoolId: 17, neededG: 80, prints: 2, runsOutAfter: null }),
      expect.objectContaining({ spoolId: 21, neededG: 10, prints: 2, runsOutAfter: 1 }),
    ])
  })
})
