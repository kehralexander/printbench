import { describe, expect, it } from 'vitest'
import type { FilamentSlot } from './printer-status'
import {
  describeFilament,
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

const request = (id: string, extra: Partial<Parameters<typeof loadNextHints>[1][number]> = {}) => ({
  id,
  title: id,
  material: null,
  colorHex: null,
  spoolmanSpoolId: null,
  ...extra,
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
})

const queued = (id: string, extra: Partial<ForecastRequest> = {}): ForecastRequest => ({
  id,
  title: id,
  status: 'requested',
  spoolmanSpoolId: 17,
  filamentG: 100,
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
          queued('a', { filamentG: null }),
          queued('b', { spoolmanSpoolId: null }),
          queued('c', { spoolmanSpoolId: 99 }),
        ],
        new Map([[17, 10]]),
      ),
    ).toEqual([])
  })
})
