import { describe, expect, it } from 'vitest'
import { groupFiles, sharedPrefix, splitVariant } from './file-groups'

const file = (filename: string) => ({
  id: filename,
  filename,
  extension: filename.split('.').pop() ?? '',
})

describe('splitVariant', () => {
  it('splits at the first word with a digit', () => {
    expect(splitVariant('Dosing Mechanism Housing 50ml')).toEqual({
      part: 'Dosing Mechanism Housing',
      variant: '50ml',
    })
    expect(splitVariant('Tank 150mm no window')).toEqual({
      part: 'Tank',
      variant: '150mm no window',
    })
  })

  it('splits at a bracket and drops the brackets', () => {
    expect(splitVariant('Cup (up to 95ml)')).toEqual({ part: 'Cup', variant: 'up to 95ml' })
  })

  it('treats underscores as separators', () => {
    expect(splitVariant('arm_left_v2')).toEqual({ part: 'arm_left', variant: 'v2' })
  })

  it('keeps a name that starts with its digits whole', () => {
    expect(splitVariant('01 head')).toEqual({ part: '01 head', variant: '' })
  })

  it('leaves a name with no variant alone', () => {
    expect(splitVariant('Lid')).toEqual({ part: 'Lid', variant: '' })
  })
})

describe('sharedPrefix', () => {
  it('finds the prefix most names share, ending on a separator', () => {
    expect(
      sharedPrefix([
        'Detergent Dispenser - Lid',
        'Detergent Dispenser - Cup (up to 95ml)',
        'Detergent Dispenser - Tank 120mm',
        'Detergent+Dispenser',
      ]),
    ).toBe('Detergent Dispenser - ')
  })

  it('needs a few files before trusting a prefix', () => {
    expect(sharedPrefix(['Body left', 'Body right'])).toBe('')
  })
})

describe('groupFiles', () => {
  const names = [
    'Detergent Dispenser - 50ml.3mf',
    'Detergent+Dispenser.3mf',
    'Detergent Dispenser - Lid.stl',
    'Detergent Dispenser - Cup (up to 95ml).stl',
    'Detergent Dispenser - Cup (up to 120ml).stl',
    'Detergent Dispenser - Dosing Mechanism 50ml.stl',
    'Detergent Dispenser - Dosing Mechanism 120ml.stl',
    'Detergent Dispenser - Dosing Mechanism 40ml.stl',
    'Detergent Dispenser - Dosing Mechanism Housing 40ml.stl',
    'Detergent Dispenser - Tank 120mm no window.stl',
    'Detergent Dispenser - Tank 120mm.stl',
  ]
  const { prefix, groups } = groupFiles(names.map(file))
  const byPart = Object.fromEntries(groups.map((g) => [`${g.part}.${g.extension}`, g]))

  it('strips the shared prefix', () => {
    expect(prefix).toBe('Detergent Dispenser - ')
  })

  it('merges variants of a part and sorts them naturally', () => {
    expect(byPart['Dosing Mechanism.stl']!.variants.map((v) => v.label)).toEqual([
      '40ml',
      '50ml',
      '120ml',
    ])
    expect(byPart['Tank.stl']!.variants.map((v) => v.label)).toEqual(['120mm', '120mm no window'])
  })

  it('does not merge a part into a longer one that starts the same', () => {
    expect(byPart['Dosing Mechanism Housing 40ml.stl']!.variants).toHaveLength(1)
  })

  it('shows a lone file under its whole name', () => {
    expect(byPart['50ml.3mf']).toBeDefined()
    expect(byPart['Detergent+Dispenser.3mf']).toBeDefined()
    expect(byPart['Lid.stl']!.variants[0]!.label).toBe('')
  })

  it('keeps parts in different folders apart', () => {
    const split = groupFiles([file('a/Arm 1.stl'), file('b/Arm 2.stl')]).groups
    expect(split).toHaveLength(2)
  })
})
