import { describe, expect, it } from 'vitest'
import { parseSearchParams } from './params'

const id = '0b6f5a0e-3c1d-4f7a-9b2e-5d8c1a2b3c4d'

describe('parseSearchParams', () => {
  it('drops library, creator and tag filters that are not ids', () => {
    const params = parseSearchParams({
      tag: ['organizer', id],
      creator: 'ready-set-print',
      library: id,
    })
    expect(params.tag).toEqual([id])
    expect(params.creator).toEqual([])
    expect(params.library).toEqual([id])
  })

  it('keeps licence and format filters as text', () => {
    const params = parseSearchParams({ license: 'CC-BY-4.0', format: 'stl' })
    expect(params.license).toEqual(['CC-BY-4.0'])
    expect(params.format).toEqual(['stl'])
  })
})
