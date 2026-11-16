import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { readGcodeTools, scanUsedTools, scanUsedToolsStream } from './gcode-tools'

const ORCA_TWO_TOOLS = `
; filament used [g] = 12.30, 4.50
; filament_colour = #FF0000;#0000FF
; filament_type = PLA;PETG
`

describe('readGcodeTools', () => {
  it('reads one filament per tool with its grams', () => {
    expect(readGcodeTools('', ORCA_TWO_TOOLS)).toEqual([
      { tool: 0, material: 'PLA', colorHex: '#ff0000', grams: 12.3, used: true },
      { tool: 1, material: 'PETG', colorHex: '#0000ff', grams: 4.5, used: true },
    ])
  })

  it('counts a tool with no grams as unused when nothing was scanned', () => {
    const tools = readGcodeTools('', ORCA_TWO_TOOLS.replace('4.50', '0.00'))
    expect(tools.map((tool) => tool.used)).toEqual([true, false])
  })

  it('lets the scanned tool changes decide over the grams', () => {
    const tools = readGcodeTools('', ORCA_TWO_TOOLS, new Set([1]))
    expect(tools.map((tool) => tool.used)).toEqual([false, true])
  })

  it('does not split a single total across several tools', () => {
    const tools = readGcodeTools(
      '; total filament weight [g] : 16.8\n',
      '; filament_type = PLA;PLA;PLA\n',
    )
    expect(tools).toHaveLength(3)
    expect(tools.every((tool) => tool.grams === null)).toBe(true)
  })

  it('takes a single total as the grams of a single tool', () => {
    expect(readGcodeTools('', '; filament used [g] = 7.1\n; filament_type = PETG\n')).toEqual([
      { tool: 0, material: 'PETG', colorHex: null, grams: 7.1, used: true },
    ])
  })

  it("uses the header's 1-based filament list when there are no grams", () => {
    const tools = readGcodeTools('; filament: 1,3\n', '; filament_type = PLA;PLA;PLA\n')
    expect(tools.map((tool) => tool.used)).toEqual([true, false, true])
  })

  it('returns nothing for a file that names no filament', () => {
    expect(readGcodeTools('G28\n', 'G1 X0\n')).toEqual([])
  })
})

describe('scanUsedTools', () => {
  it('finds tool changes at the start of lines only', () => {
    expect([...scanUsedTools('T0\nG1 X1\n  T2 ; swap\nM104 T1 S200\n')].sort()).toEqual([0, 2])
  })

  it('finds a tool change split across stream chunks', async () => {
    const used = await scanUsedToolsStream(
      Readable.from([Buffer.from('G1\nT'), Buffer.from('3\nG1\n')]),
    )
    expect([...used]).toEqual([3])
  })
})
