import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '@pb/core'
import { freePath, pathWithinModel } from './model-target'

describe('pathWithinModel', () => {
  it('keeps a bare filename as it is', () => {
    expect(pathWithinModel('plate.gcode')).toBe('plate.gcode')
  })

  it('keeps folders the grouping step treats as part of a model', () => {
    expect(pathWithinModel('presupported/body.stl')).toBe('presupported/body.stl')
    expect(pathWithinModel('stl/presupported/body.stl')).toBe('stl/presupported/body.stl')
  })

  it('flattens any other folder, which would become a model of its own', () => {
    expect(pathWithinModel('Dragon Wings/left.stl')).toBe('left.stl')
    expect(pathWithinModel('stl/Wings/left.stl')).toBe('left.stl')
  })
})

describe('freePath', () => {
  const storageWith = (paths: string[]) =>
    ({
      stat: async (path: string) =>
        paths.includes(path) ? { path, isDirectory: false, size: 1, mtimeMs: 0 } : null,
    }) as unknown as StorageAdapter

  it('uses the name as given when nothing is there', async () => {
    expect(await freePath(storageWith([]), 'Dragon/plate.gcode')).toBe('Dragon/plate.gcode')
  })

  it('never replaces an existing file', async () => {
    const storage = storageWith(['Dragon/plate.gcode', 'Dragon/plate (1).gcode'])
    expect(await freePath(storage, 'Dragon/plate.gcode')).toBe('Dragon/plate (2).gcode')
  })

  it('handles names without an extension', async () => {
    expect(await freePath(storageWith(['Dragon/README']), 'Dragon/README')).toBe(
      'Dragon/README (1)',
    )
  })
})
