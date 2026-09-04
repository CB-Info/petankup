import { describe, expect, it } from 'vitest'
import type {
  FullUserProfileBundle,
  Teammate,
  UserFreeMatchResult,
  UserTournamentResult,
} from '../../app/types'
import { linkedPlayerUserIdsIn } from '../../app/utils/profile-bundle'

const VIEWED_USER_ID = '88888888-8888-4888-8888-888888888888'
const CAROL_ID = '77777777-7777-4777-8777-777777777777'
const DAVE_ID = '66666666-6666-4666-8666-666666666666'
const NOW = '2026-01-01T00:00:00.000Z'

function makeResult(teammates: Teammate[]): UserTournamentResult {
  return {
    tournamentId: crypto.randomUUID(),
    tournamentName: 'Tournoi',
    tournamentDate: '2026-05-10',
    tournamentCompletedAt: NOW,
    teamId: crypto.randomUUID(),
    teamName: 'Team',
    wins: 2,
    losses: 1,
    pointsScored: 30,
    pointsConceded: 20,
    finalRank: 1,
    isWinner: true,
    isPodium: true,
    viewerCanOpen: true,
    teammates,
  }
}

function makeFreeMatch(teammates: Teammate[], opponents: Teammate[]): UserFreeMatchResult {
  return {
    matchId: crypto.randomUUID(),
    playedOn: '2026-08-20',
    createdAt: NOW,
    scoreA: 13,
    scoreB: 7,
    side: 'A',
    viewerCanOpen: true,
    teammates,
    opponents,
  }
}

function makeFullBundle(overrides: Partial<FullUserProfileBundle> = {}): FullUserProfileBundle {
  return {
    kind: 'full',
    profile: { id: VIEWED_USER_ID, displayName: 'Bob', createdAt: NOW, updatedAt: NOW },
    stats: null,
    results: [],
    freeMatches: [],
    freeMatchStats: null,
    ...overrides,
  }
}

describe('linkedPlayerUserIdsIn', () => {
  it('collecte les joueurs liés des tournois ET des matchs libres (coéquipiers et adversaires)', () => {
    const bundle = makeFullBundle({
      results: [makeResult([{ userId: CAROL_ID, displayName: 'Carol' }])],
      freeMatches: [
        makeFreeMatch(
          [{ userId: null, displayName: 'Marcel' }],
          [{ userId: DAVE_ID, displayName: 'Dave' }],
        ),
      ],
    })

    expect(linkedPlayerUserIdsIn(bundle, VIEWED_USER_ID)).toEqual([CAROL_ID, DAVE_ID])
  })

  it('exclut les joueurs libres (sans compte) et le profil consulté lui-même', () => {
    const bundle = makeFullBundle({
      results: [
        makeResult([
          { userId: null, displayName: 'Pierre' },
          { userId: VIEWED_USER_ID, displayName: 'Bob' },
        ]),
      ],
    })

    expect(linkedPlayerUserIdsIn(bundle, VIEWED_USER_ID)).toEqual([])
  })

  it('ne dédoublonne pas (c’est loadProfilesByIds qui dédoublonne et filtre le cache)', () => {
    const bundle = makeFullBundle({
      results: [
        makeResult([{ userId: CAROL_ID, displayName: 'Carol' }]),
        makeResult([{ userId: CAROL_ID, displayName: 'Carol' }]),
      ],
    })

    expect(linkedPlayerUserIdsIn(bundle, VIEWED_USER_ID)).toEqual([CAROL_ID, CAROL_ID])
  })

  it('rend une liste vide sur un journal vide', () => {
    expect(linkedPlayerUserIdsIn(makeFullBundle(), VIEWED_USER_ID)).toEqual([])
  })
})
