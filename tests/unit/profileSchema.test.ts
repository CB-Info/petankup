import { describe, expect, it } from 'vitest'
import { profileSchema } from '../../app/utils/profileSchema'

describe('profileSchema', () => {
  it('accepts a one-character display name', () => {
    const result = profileSchema.safeParse({ displayName: 'A' })
    expect(result.success).toBe(true)
  })

  it('accepts a display name of exactly 50 characters', () => {
    const result = profileSchema.safeParse({ displayName: 'a'.repeat(50) })
    expect(result.success).toBe(true)
  })

  it('rejects an empty display name', () => {
    const result = profileSchema.safeParse({ displayName: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a display name made only of spaces (trims to empty)', () => {
    const result = profileSchema.safeParse({ displayName: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects a display name longer than 50 characters', () => {
    const result = profileSchema.safeParse({ displayName: 'a'.repeat(51) })
    expect(result.success).toBe(false)
  })

  it('accepts a display name with internal spaces', () => {
    const result = profileSchema.safeParse({ displayName: 'Jean Dupont' })
    expect(result.success).toBe(true)
  })

  it('trims the parsed output', () => {
    const result = profileSchema.safeParse({ displayName: '  Alice  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.displayName).toBe('Alice')
    }
  })
})
