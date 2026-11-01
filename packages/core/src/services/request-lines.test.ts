import { describe, expect, it } from 'vitest'
import { formatEstimate, parseEstimate } from './request-lines'

describe('parseEstimate', () => {
  it.each([
    ['2h 10m', 130],
    ['2h10m', 130],
    ['2 hours 10 minutes', 130],
    ['2h', 120],
    ['45m', 45],
    ['45 min', 45],
    ['1.5h', 90],
    ['1,5h', 90],
    ['2:10', 130],
    ['0:45', 45],
    ['90', 90],
    ['1d 2h', 1560],
    ['  3H 5M ', 185],
  ])('reads %j as %i minutes', (input, minutes) => {
    expect(parseEstimate(input)).toBe(minutes)
  })

  it.each(['', '   ', 'soon', '2h later', 'h', '2:75', '0', '-5', '31d'])('refuses %j', (input) => {
    expect(parseEstimate(input)).toBeNull()
  })
})

describe('formatEstimate', () => {
  it.each([
    [45, '45m'],
    [60, '1h'],
    [130, '2h 10m'],
    [1440, '1d'],
    [1560, '1d 2h'],
  ])('formats %i minutes as %j', (minutes, text) => {
    expect(formatEstimate(minutes)).toBe(text)
  })

  it('round-trips through parseEstimate', () => {
    for (const minutes of [1, 59, 61, 130, 1439, 1500]) {
      const text = formatEstimate(minutes)
      // Days drop leftover minutes on purpose; below a day it is exact.
      if (minutes < 1440) expect(parseEstimate(text)).toBe(minutes)
    }
  })
})
