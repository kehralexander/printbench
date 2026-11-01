import { describe, expect, it } from 'vitest'
import { colourDistance, loadedFilament, materialFamily } from './loaded-filament'
import type { FilamentSlot } from './printer-status'

const slot = (index: number, extra: Partial<FilamentSlot> = {}): FilamentSlot => ({
  index,
  loaded: true,
  active: false,
  ...extra,
})

const ace = [
  {
    printerName: 'Kobra X',
    slots: [
      slot(0, { material: 'PLA', colorHex: '#ffffff', spoolmanSpoolId: 12 }),
      slot(1, { material: 'PLA MATTE', colorHex: '#17223b', spoolmanSpoolId: 17 }),
      slot(2, { loaded: false }),
      slot(3, { material: 'PETG', colorHex: '#101010', spoolmanSpoolId: 21 }),
    ],
  },
]

describe('is the filament loaded', () => {
  it('finds a Spoolman spool by id', () => {
    expect(
      loadedFilament({ spoolmanSpoolId: 17, material: 'PLA', colorHex: '#17223b' }, ace),
    ).toMatchObject({ loaded: true, printerName: 'Kobra X', slot: { index: 1 } })
  })

  it('says a spool is not loaded when the printer tracks spools and that one is absent', () => {
    // Even though a black-ish PETG is loaded, the spool asked for is not.
    const verdict = loadedFilament(
      { spoolmanSpoolId: 99, material: 'PETG', colorHex: '#000000' },
      ace,
    )
    expect(verdict).toMatchObject({ loaded: false })
    expect(verdict?.loaded === false && verdict.instead.map((s) => s.index)).toEqual([0, 1, 3])
  })

  it('matches material family and a close colour without a spool', () => {
    expect(
      loadedFilament({ spoolmanSpoolId: null, material: 'PETG', colorHex: '#000000' }, ace),
    ).toMatchObject({ loaded: true, slot: { index: 3 } })
    expect(
      loadedFilament({ spoolmanSpoolId: null, material: 'PLA', colorHex: '#1a2540' }, ace),
    ).toMatchObject({ loaded: true, slot: { index: 1 } })
  })

  it('does not call a different colour the same', () => {
    expect(
      loadedFilament({ spoolmanSpoolId: null, material: 'PLA', colorHex: '#ff0000' }, ace),
    ).toMatchObject({ loaded: false })
  })

  it('does not call a different material the same', () => {
    expect(
      loadedFilament({ spoolmanSpoolId: null, material: 'ABS', colorHex: '#ffffff' }, ace),
    ).toMatchObject({ loaded: false })
  })

  it('has no opinion without slots or without a wish', () => {
    expect(loadedFilament({ spoolmanSpoolId: 17, material: null, colorHex: null }, [])).toBeNull()
    expect(
      loadedFilament({ spoolmanSpoolId: null, material: null, colorHex: null }, ace),
    ).toBeNull()
  })

  it('groups material variants into families', () => {
    expect(materialFamily('PLA Matte')).toBe('PLA')
    expect(materialFamily('PLA+')).toBe('PLA')
    expect(materialFamily('petg-cf')).toBe('PETG')
    expect(colourDistance('#000000', '#ffffff')).toBeCloseTo(441.67, 1)
  })
})
