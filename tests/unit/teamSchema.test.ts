import { describe, expect, it } from 'vitest'
import { teamSchema } from '../../app/utils/teamSchema'

describe('teamSchema', () => {
  describe('name', () => {
    it('rejects a name shorter than 2 characters', () => {
      const result = teamSchema.safeParse({
        name: 'A',
        players: ['Joueur 1'],
      })
      expect(result.success).toBe(false)
    })

    it('rejects a name longer than 50 characters', () => {
      const tooLongName = 'a'.repeat(51)
      const result = teamSchema.safeParse({
        name: tooLongName,
        players: ['Joueur 1'],
      })
      expect(result.success).toBe(false)
    })

    it('accepts a name of exactly 2 characters', () => {
      const result = teamSchema.safeParse({
        name: 'AB',
        players: ['Joueur 1'],
      })
      expect(result.success).toBe(true)
    })

    it('accepts a name of exactly 50 characters', () => {
      const result = teamSchema.safeParse({
        name: 'a'.repeat(50),
        players: ['Joueur 1'],
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
        players: ['A', 'B', 'C', 'D'],
      })
      expect(result.success).toBe(false)
    })

    it('accepts a single player (tête-à-tête)', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: ['Solo'],
      })
      expect(result.success).toBe(true)
    })

    it('accepts two players (doublette)', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: ['Alice', 'Bob'],
      })
      expect(result.success).toBe(true)
    })

    it('accepts three players (triplette)', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: ['Alice', 'Bob', 'Chloé'],
      })
      expect(result.success).toBe(true)
    })

    it('rejects a player with an empty name', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: ['Alice', ''],
      })
      expect(result.success).toBe(false)
    })

    it('rejects a player name longer than 50 characters', () => {
      const result = teamSchema.safeParse({
        name: 'Les Invincibles',
        players: ['a'.repeat(51)],
      })
      expect(result.success).toBe(false)
    })
  })
})
