import { describe, expect, it } from 'vitest'
import {
  WINNING_SCORE,
  clampScoreToInputBounds,
  validateMatchScore,
} from '../../app/utils/score'

// Contrat de LA règle de score partagée (tournoi ET match libre) : suite
// héritée de l'ancienne suite du match libre (messages exacts), enrichie
// des vecteurs de l'ancienne suite tournoi — dont 15-12, accepté par la
// règle laxiste d'avant (« au moins 13 »), rejeté depuis.

describe('validateMatchScore', () => {
  it('plays a pétanque match to exactly 13 points', () => {
    expect(WINNING_SCORE).toBe(13)
  })

  it.each([
    [13, 0],
    [13, 7],
    [13, 12],
    [0, 13],
    [12, 13],
  ])('accepts %i-%i (winner exactly 13, loser 0-12)', (scoreA, scoreB) => {
    expect(validateMatchScore(scoreA, scoreB)).toEqual({ valid: true })
  })

  it.each([
    [13, 13],
    [0, 0],
  ])('rejects a draw (%i-%i)', (scoreA, scoreB) => {
    expect(validateMatchScore(scoreA, scoreB)).toEqual({
      valid: false,
      error: 'Pas de match nul à la pétanque.',
    })
  })

  it.each([
    [12, 5],
    [12, 11],
    [15, 12],
    [20, 0],
    [14, 13],
  ])('rejects %i-%i (the winner must have exactly 13)', (scoreA, scoreB) => {
    expect(validateMatchScore(scoreA, scoreB)).toEqual({
      valid: false,
      error: 'Le vainqueur doit avoir exactement 13 points.',
    })
  })

  it.each([
    [-1, 5],
    [-1, 13],
    [5.5, 3],
    [13.5, 2],
    [Number.NaN, 13],
  ])('rejects %s-%s (scores must be non-negative integers)', (scoreA, scoreB) => {
    expect(validateMatchScore(scoreA, scoreB)).toEqual({
      valid: false,
      error: 'Les scores doivent être des entiers positifs ou nuls.',
    })
  })
})

describe('clampScoreToInputBounds', () => {
  it.each([
    [-1, 0],
    [0, 0],
    [7, 7],
    [13, 13],
    [14, 13],
    [99, 13],
  ])('clamps %i to %i (input bounds [0, 13])', (rawScore, clampedScore) => {
    expect(clampScoreToInputBounds(rawScore)).toBe(clampedScore)
  })
})
