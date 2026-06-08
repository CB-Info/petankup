import { describe, expect, it } from 'vitest'
import { teamSchema } from '../../app/utils/teamSchema'

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'

// Helper : un joueur libre (userId null) au displayName donné.
function free(displayName: string) {
  return { userId: null, displayName }
}

// Helper : un joueur lié à un compte.
function linked(userId: string, displayName: string) {
  return { userId, displayName }
}

describe('teamSchema', () => {
  describe('name', () => {
    it('rejects a name shorter than 2 characters', () => {
      const result = teamSchema.safeParse({
        name: 'A',
        players: [free('Joueur 1')],
      })
      expect(result.success).toBe(false)
    })

    it('rejects a name longer than 50 characters', () => {
      const result = teamSchema.safeParse({
        name: 'a'.repeat(51),
        players: [free('Joueur 1')],
      })
      expect(result.success).toBe(false)
    })

    it('accepts a name of exactly 2 characters', () => {
      const result = teamSchema.safeParse({
        name: 'AB',
        players: [free('Joueur 1')],
      })
      expect(result.success).toBe(true)
    })

    it('accepts a name of exactly 50 characters', () => {
      const result = teamSchema.safeParse({
        name: 'a'.repeat(50),
        players: [free('Joueur 1')],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('players', () => {
    it('rejects an empty players array', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: [],
      })
      expect(result.success).toBe(false)
    })

    it('rejects more than 3 players', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: [free('A'), free('B'), free('C'), free('D')],
      })
      expect(result.success).toBe(false)
    })

    it('accepts a linked player (userId set)', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: [linked(USER_A, 'Alice')],
      })
      expect(result.success).toBe(true)
    })

    it('accepts a free player (userId null)', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: [free('Pierre')],
      })
      expect(result.success).toBe(true)
    })

    it('rejects a player with an empty name (after trim)', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: [free('Alice'), free('   ')],
      })
      expect(result.success).toBe(false)
    })

    it('rejects a player name longer than 50 characters', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: [free('a'.repeat(51))],
      })
      expect(result.success).toBe(false)
    })

    it('rejects the same linked userId in two slots', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: [linked(USER_A, 'Alice'), linked(USER_A, 'Alice')],
      })
      expect(result.success).toBe(false)
    })

    it('accepts two free players with the same name (homonyms allowed)', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: [free('Jean'), free('Jean')],
      })
      expect(result.success).toBe(true)
    })

    it('accepts a mix of a linked and a free player', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: [linked(USER_A, 'Alice'), free('Pierre'), linked(USER_B, 'Bob')],
      })
      expect(result.success).toBe(true)
    })
  })
})
