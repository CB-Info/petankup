import { describe, expect, it } from 'vitest'
import type { FreeMatchPlayer } from '../../app/types'
import {
  FREE_MATCH_FORMATS,
  emptySlot,
  freeMatchFormatForSideCount,
  freeMatchFormatOf,
  freeMatchOutcomeOf,
  isSlotFilled,
  leadingSideOf,
  moveCreatorToSide,
  playersOnSide,
  playersPerSide,
  resizeSide,
  sortFreeMatchPlayers,
  winnerSideOf,
} from '../../app/utils/free-match'
import type { FreeMatchSidesLayout, FreeMatchSlot } from '../../app/utils/free-match'

const NOW = '2026-01-01T00:00:00.000Z'
const MATCH_ID = '11111111-1111-4111-8111-111111111111'

function makePlayer(overrides: Partial<FreeMatchPlayer> = {}): FreeMatchPlayer {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    matchId: MATCH_ID,
    side: 'A',
    userId: null,
    displayNameSnapshot: 'Alice',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function slot(displayName: string, userId: string | null = null): FreeMatchSlot {
  return { userId, displayName }
}

describe('formats', () => {
  it('lists the three formats in size order with 1, 2 and 3 players per side', () => {
    expect(FREE_MATCH_FORMATS).toEqual(['tete_a_tete', 'doublette', 'triplette'])
    expect(FREE_MATCH_FORMATS.map(playersPerSide)).toEqual([1, 2, 3])
  })

  it('derives the format of a stored match from the size of side A', () => {
    const doublette = [
      makePlayer({ id: 'a1', side: 'A' }),
      makePlayer({ id: 'a2', side: 'A' }),
      makePlayer({ id: 'b1', side: 'B' }),
      makePlayer({ id: 'b2', side: 'B' }),
    ]
    expect(freeMatchFormatOf(doublette)).toBe('doublette')
    expect(freeMatchFormatOf([makePlayer({ side: 'A' }), makePlayer({ id: 'b', side: 'B' })])).toBe('tete_a_tete')
  })

  it('returns null when side A has no matching format (defensive)', () => {
    expect(freeMatchFormatOf([])).toBeNull()
  })

  it('derives the format from a single side head count (journal entries)', () => {
    expect(freeMatchFormatForSideCount(1)).toBe('tete_a_tete')
    expect(freeMatchFormatForSideCount(2)).toBe('doublette')
    expect(freeMatchFormatForSideCount(3)).toBe('triplette')
    expect(freeMatchFormatForSideCount(0)).toBeNull()
    expect(freeMatchFormatForSideCount(4)).toBeNull()
  })

  it('playersOnSide filters by side', () => {
    const players = [makePlayer({ id: 'a', side: 'A' }), makePlayer({ id: 'b', side: 'B' })]
    expect(playersOnSide(players, 'B').map(player => player.id)).toEqual(['b'])
  })
})

describe('isSlotFilled', () => {
  it('is false for an empty slot and for a whitespace-only name', () => {
    expect(isSlotFilled(emptySlot())).toBe(false)
    expect(isSlotFilled(slot('   '))).toBe(false)
  })

  it('is true for a free player with a name and for a linked account', () => {
    expect(isSlotFilled(slot('Alice'))).toBe(true)
    expect(isSlotFilled(slot('', 'user-1'))).toBe(true)
  })
})

describe('resizeSide', () => {
  it('pads with empty slots when the side grows', () => {
    const result = resizeSide([slot('Alice')], 3)
    expect(result.slots).toEqual([slot('Alice'), emptySlot(), emptySlot()])
    expect(result.droppedFilledCount).toBe(0)
  })

  it('keeps filled slots in order and drops empty ones first when shrinking', () => {
    const result = resizeSide([emptySlot(), slot('Alice'), slot('Bob', 'user-b')], 2)
    expect(result.slots).toEqual([slot('Alice'), slot('Bob', 'user-b')])
    expect(result.droppedFilledCount).toBe(0)
  })

  it('reports how many filled players were dropped when shrinking below them', () => {
    const result = resizeSide([slot('Alice'), slot('Bob'), slot('Chloé')], 1)
    expect(result.slots).toEqual([slot('Alice')])
    expect(result.droppedFilledCount).toBe(2)
  })

  it('returns fresh empty slots (no shared object between slots)', () => {
    const result = resizeSide([], 2)
    expect(result.slots[0]).not.toBe(result.slots[1])
  })
})

describe('moveCreatorToSide', () => {
  // Créateur en A : A a un slot de moins que B (le créateur n'occupe pas de slot).
  const layout: FreeMatchSidesLayout = {
    creatorSide: 'A',
    sideA: [slot('Alice')],
    sideB: [slot('Bob'), slot('Chloé')],
  }

  it('hands the first slot of the arriving side over to the leaving side', () => {
    const moved = moveCreatorToSide(layout, 'B')
    expect(moved).toEqual({
      creatorSide: 'B',
      sideA: [slot('Bob'), slot('Alice')],
      sideB: [slot('Chloé')],
    })
  })

  it('keeps the per-side head count invariant (creator side has one slot less)', () => {
    const moved = moveCreatorToSide(layout, 'B')
    expect(moved.sideA.length).toBe(2)
    expect(moved.sideB.length).toBe(1)
  })

  it('is reversible: moving back restores the original layout', () => {
    const roundTrip = moveCreatorToSide(moveCreatorToSide(layout, 'B'), 'A')
    expect(roundTrip).toEqual(layout)
  })

  it('returns the same layout when the creator is already on the target side', () => {
    expect(moveCreatorToSide(layout, 'A')).toBe(layout)
  })

  it('works in tête-à-tête (leaving side has no slot)', () => {
    const single: FreeMatchSidesLayout = { creatorSide: 'A', sideA: [], sideB: [slot('Bob')] }
    expect(moveCreatorToSide(single, 'B')).toEqual({
      creatorSide: 'B',
      sideA: [slot('Bob')],
      sideB: [],
    })
  })
})

// La suite de la règle de score vit dans score.test.ts (source unique
// partagée par les deux domaines : app/utils/score).

describe('leadingSideOf / winnerSideOf', () => {
  it('returns the side ahead, or null on a tie', () => {
    expect(leadingSideOf(5, 3)).toBe('A')
    expect(leadingSideOf(3, 5)).toBe('B')
    expect(leadingSideOf(0, 0)).toBeNull()
  })

  it('winnerSideOf follows the same rule on final scores', () => {
    expect(winnerSideOf(13, 7)).toBe('A')
    expect(winnerSideOf(2, 13)).toBe('B')
  })
})

describe('freeMatchOutcomeOf', () => {
  it('reports a win with the player points first, on side A', () => {
    expect(freeMatchOutcomeOf({ side: 'A', scoreA: 13, scoreB: 7 })).toEqual({
      won: true,
      pointsScored: 13,
      pointsConceded: 7,
    })
  })

  it('reports a win on side B (the side pivot, not the raw scores)', () => {
    expect(freeMatchOutcomeOf({ side: 'B', scoreA: 9, scoreB: 13 })).toEqual({
      won: true,
      pointsScored: 13,
      pointsConceded: 9,
    })
  })

  it('reports a loss with the player points still first', () => {
    expect(freeMatchOutcomeOf({ side: 'A', scoreA: 5, scoreB: 13 })).toEqual({
      won: false,
      pointsScored: 5,
      pointsConceded: 13,
    })
  })
})

describe('sortFreeMatchPlayers', () => {
  it('sorts by snapshot name with French collation (accents and case folded)', () => {
    const players = [
      makePlayer({ id: 'p1', displayNameSnapshot: 'Zoé' }),
      makePlayer({ id: 'p2', displayNameSnapshot: 'Émile' }),
      makePlayer({ id: 'p3', displayNameSnapshot: 'alice' }),
    ]
    expect(sortFreeMatchPlayers(players).map(player => player.displayNameSnapshot)).toEqual([
      'alice',
      'Émile',
      'Zoé',
    ])
  })

  it('breaks ties on id so the order is stable between two loads', () => {
    const players = [
      makePlayer({ id: 'p2', displayNameSnapshot: 'Alice' }),
      makePlayer({ id: 'p1', displayNameSnapshot: 'Alice' }),
    ]
    expect(sortFreeMatchPlayers(players).map(player => player.id)).toEqual(['p1', 'p2'])
  })

  it('does not mutate its input', () => {
    const players = [
      makePlayer({ id: 'p1', displayNameSnapshot: 'Zoé' }),
      makePlayer({ id: 'p2', displayNameSnapshot: 'Alice' }),
    ]
    sortFreeMatchPlayers(players)
    expect(players.map(player => player.id)).toEqual(['p1', 'p2'])
  })
})
