import { describe, expect, it } from 'vitest'
import {
  flattenGroups,
  groupRows,
  groupTitle,
  partName,
  partNameFromFile,
  type GroupableRow,
} from './grouping'

function row(id: string, patch: Partial<GroupableRow> = {}): GroupableRow {
  return {
    id,
    title: 'Laundry Detergent Dispenser',
    modelId: 'm1',
    modelName: 'Laundry Detergent Dispenser',
    customerId: null,
    requestedBy: 'Alexander',
    filename: null,
    ...patch,
  }
}

describe('partNameFromFile', () => {
  it.each([
    ['Tank - Small (without window)_PLA_0.16_10h45m24s.gcode', 'Tank - Small (without window)'],
    ['Base - Standard (up to 95ml)_PLA_0.16_5h18m25s.gcode', 'Base - Standard (up to 95ml)'],
    ['6x Cup split_PLA_0.2_3h39m49s.gcode', '6x Cup split'],
    ['2x Splitter_PLA_0.2_52m58s.gcode', '2x Splitter'],
    ['plates/Cup_XL_PETG_0.2mm_1d2h.gcode', 'Cup XL'],
    ['Cup_XL_0.2_PLA-CF_3h.gcode', 'Cup XL'],
    ['Bracket.3mf', 'Bracket'],
    ['Left_bracket.stl', 'Left bracket'],
  ])('%s → %s', (filename, expected) => {
    expect(partNameFromFile(filename)).toBe(expected)
  })

  it('is null when only the slicer suffix is left', () => {
    expect(partNameFromFile('PLA_0.2_2h7m21s.gcode')).toBeNull()
    expect(partNameFromFile(null)).toBeNull()
  })
})

describe('partName', () => {
  it('prefers the part from the file', () => {
    expect(partName(row('a', { filename: 'Lid_PLA_0.16_1h18m16s.gcode' }))).toBe('Lid')
  })

  it('falls back to a title that says more than the model name', () => {
    expect(partName(row('a', { title: 'Spare lid' }))).toBe('Spare lid')
  })

  it('falls back to the file when the title is only the model name', () => {
    expect(partName(row('a', { filename: 'x/PLA_0.2_2h7m21s.gcode' }))).toBe(
      'PLA_0.2_2h7m21s.gcode',
    )
  })
})

describe('groupRows', () => {
  it('groups one model for one person, in first-appearance order', () => {
    const rows = [
      row('a'),
      row('b', { modelId: 'm2', modelName: 'Dividers' }),
      row('c'),
      row('d', { modelId: null, modelName: null, title: 'Something' }),
    ]
    const groups = groupRows(rows)
    expect(groups.map((group) => group.rows.map((r) => r.id))).toEqual([['a', 'c'], ['b'], ['d']])
    expect(groupTitle(groups[1]!)).toBe('Dividers')
    expect(flattenGroups(groups)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('keeps different requesters of one model apart', () => {
    const groups = groupRows([
      row('a'),
      row('b', { requestedBy: 'Sam' }),
      row('c', { requestedBy: 'alexander ' }),
    ])
    expect(groups.map((group) => group.rows.map((r) => r.id))).toEqual([['a', 'c'], ['b']])
  })

  it('leaves every row alone when grouping is off', () => {
    expect(groupRows([row('a'), row('b')], false)).toHaveLength(2)
  })
})
