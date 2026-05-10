import { describe, expect, it } from 'vitest'
import { tournamentSchema } from '../../app/utils/tournamentSchema'

const validBase = {
  name: 'Tournoi de test',
  date: '2026-05-10',
  location: '',
  description: '',
}

describe('tournamentSchema', () => {
  describe('visibility', () => {
    it('applies default visibility "private" when omitted', () => {
      const result = tournamentSchema.safeParse(validBase)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.visibility).toBe('private')
      }
    })

    it('accepts visibility "private" explicitly', () => {
      const result = tournamentSchema.safeParse({
        ...validBase,
        visibility: 'private',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.visibility).toBe('private')
      }
    })

    it('accepts visibility "public" explicitly', () => {
      const result = tournamentSchema.safeParse({
        ...validBase,
        visibility: 'public',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.visibility).toBe('public')
      }
    })

    it('rejects an unknown visibility value', () => {
      const result = tournamentSchema.safeParse({
        ...validBase,
        visibility: 'unlisted',
      })
      expect(result.success).toBe(false)
    })
  })
})
