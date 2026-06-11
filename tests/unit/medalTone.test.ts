import { describe, expect, it } from 'vitest'
import { medalTone } from '../../app/utils/medalTone'

describe('medalTone', () => {
  it('returns gold for rank 1', () => {
    expect(medalTone(1)).toBe('gold')
  })

  it('returns silver for rank 2', () => {
    expect(medalTone(2)).toBe('silver')
  })

  it('returns bronze for rank 3', () => {
    expect(medalTone(3)).toBe('bronze')
  })

  it('returns horizon for rank 4', () => {
    expect(medalTone(4)).toBe('horizon')
  })

  it('returns horizon beyond rank 4', () => {
    expect(medalTone(5)).toBe('horizon')
  })
})
