import { describe, expect, it } from 'vitest'
import { MAX_DRIFT_SEC, projectReading } from './project-reading'

describe('projecting a printer reading', () => {
  const reading = { progress: 0.5, elapsedSec: 600, remainingSec: 600 }

  it('leaves a brand-new reading alone', () => {
    expect(projectReading(reading, 0)).toEqual(reading)
  })

  it('counts elapsed up, remaining down, and closes the gap at the estimated pace', () => {
    expect(projectReading(reading, 60)).toEqual({
      progress: 0.55,
      elapsedSec: 660,
      remainingSec: 540,
    })
  })

  it('stops drifting once the reading is too old to trust', () => {
    expect(projectReading(reading, MAX_DRIFT_SEC * 10)).toEqual(
      projectReading(reading, MAX_DRIFT_SEC),
    )
  })

  it('never projects a running print to done', () => {
    const almost = { progress: 0.99, elapsedSec: 6000, remainingSec: 30 }
    const projected = projectReading(almost, 90)
    expect(projected.progress).toBeLessThan(1)
    expect(projected.progress).toBeGreaterThan(0.99)
    expect(projected.remainingSec).toBe(0)
  })

  it('keeps progress still when there is no estimate to pace it', () => {
    const projected = projectReading({ progress: 0.3, elapsedSec: 100, remainingSec: null }, 30)
    expect(projected).toEqual({ progress: 0.3, elapsedSec: 130, remainingSec: null })
  })

  it('ignores a negative age', () => {
    expect(projectReading(reading, -5)).toEqual(reading)
  })
})
