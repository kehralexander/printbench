import { describe, expect, it } from 'vitest'
import {
  FilamentRowError,
  cleanFilaments,
  mergeFilaments,
  totalGrams,
  type RequestFilament,
} from './request-filaments'

const row = (extra: Partial<RequestFilament> = {}): RequestFilament => ({
  tool: null,
  material: null,
  colorHex: null,
  colorName: null,
  spoolmanSpoolId: null,
  spoolId: null,
  grams: null,
  ...extra,
})
const tool = (n: number, extra: Partial<Parameters<typeof mergeFilaments>[1][number]> = {}) => ({
  tool: n,
  material: 'PLA',
  colorHex: '#ffffff',
  grams: 10,
  used: true,
  ...extra,
})

describe('cleaning filament rows', () => {
  it('drops blank rows and tidies the rest', () => {
    expect(
      cleanFilaments([
        { material: '  PLA ', colorHex: '#FF0000' },
        { material: '', colorName: ' ' },
        { tool: 1, grams: 4.567 },
      ]),
    ).toEqual([row({ material: 'PLA', colorHex: '#ff0000' }), row({ tool: 1, grams: 4.57 })])
  })

  it('refuses a tool listed twice and values that are not what they say', () => {
    expect(() => cleanFilaments([{ tool: 0 }, { tool: 0 }])).toThrow(FilamentRowError)
    expect(() => cleanFilaments([{ colorHex: 'red' }])).toThrow(FilamentRowError)
    expect(() => cleanFilaments([{ spoolmanSpoolId: 0 }])).toThrow(FilamentRowError)
    expect(() => cleanFilaments([{ spoolId: 'nope' }])).toThrow(FilamentRowError)
  })
})

describe('merging a linked file into the rows', () => {
  it('keeps a single wish on a single-tool file and takes its grams, not its colour', () => {
    expect(
      mergeFilaments([row({ material: 'PETG', colorHex: '#ff0000' })], [tool(0, { grams: 12 })]),
    ).toEqual([row({ tool: 0, material: 'PETG', colorHex: '#ff0000', grams: 12 })])
    // "Any" stays "any": the white is only the slicer profile's.
    expect(mergeFilaments([], [tool(0)])).toEqual([row({ tool: 0, grams: 10 })])
  })

  it('fills a multi-colour file from what it was sliced with, leaving out unused tools', () => {
    expect(
      mergeFilaments(
        [],
        [
          tool(0, { colorHex: '#ff0000' }),
          tool(1, { used: false }),
          tool(2, { material: 'PETG', colorHex: '#0000ff', grams: 3 }),
        ],
      ),
    ).toEqual([
      row({ tool: 0, material: 'PLA', colorHex: '#ff0000', grams: 10 }),
      row({ tool: 2, material: 'PETG', colorHex: '#0000ff', grams: 3 }),
    ])
  })

  it('carries choices over by tool, and wishes over by order when the counts match', () => {
    const merged = mergeFilaments(
      [row({ material: 'PLA', colorHex: '#111111' }), row({ spoolmanSpoolId: 7 })],
      [tool(0), tool(1, { grams: 2 })],
    )
    expect(merged).toEqual([
      row({ tool: 0, material: 'PLA', colorHex: '#111111', grams: 10 }),
      row({ tool: 1, spoolmanSpoolId: 7, grams: 2 }),
    ])
    expect(
      mergeFilaments([row({ tool: 1, spoolmanSpoolId: 9 })], [tool(0), tool(1)])[1],
    ).toMatchObject({ tool: 1, spoolmanSpoolId: 9 })
  })

  it('turns rows back into wishes when the file goes away', () => {
    expect(mergeFilaments([row({ tool: 0, material: 'PLA', grams: 10 })], [])).toEqual([
      row({ material: 'PLA' }),
    ])
  })

  it('adds up the grams it knows', () => {
    expect(totalGrams([row({ grams: 1.25 }), row(), row({ grams: 2 })])).toBe(3.25)
    expect(totalGrams([row()])).toBeNull()
  })
})
