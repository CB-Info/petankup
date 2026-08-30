import { describe, expect, it } from 'vitest'
import type { AccountMatch, CreateFreeMatchInput, FreeMatch, FreeMatchPlayer } from '../../app/types'
import {
  mapAccountMatchRowToDomain,
  mapCreateFreeMatchInputToRpcPayload,
  mapFreeMatchPlayerRowToDomain,
  mapFreeMatchRowToDomain,
} from '../../app/repositories/supabase-mappers'
import type { FreeMatchRowWithPlayers } from '../../app/repositories/supabase-mappers'

// Mappers du match libre (H2.b), fichier dédié — même découpage que les
// tests de store. Fixtures minimales : une doublette avec un joueur lié et
// des joueurs libres.

const NOW = '2026-01-01T00:00:00.000Z'
const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const CREATOR_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'

type FreeMatchPlayerRow = FreeMatchRowWithPlayers['free_match_players'][number]

function makePlayerRow(overrides: Partial<FreeMatchPlayerRow> = {}): FreeMatchPlayerRow {
  return {
    id: 'p-free',
    match_id: MATCH_ID,
    side: 'A',
    user_id: null,
    display_name: 'Alice',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function makeMatchRow(players: FreeMatchPlayerRow[]): FreeMatchRowWithPlayers {
  return {
    id: MATCH_ID,
    created_by: CREATOR_ID,
    played_on: '2026-08-30',
    score_a: 13,
    score_b: 7,
    visibility: 'private',
    created_at: NOW,
    updated_at: NOW,
    free_match_players: players,
  }
}

describe('mapFreeMatchPlayerRowToDomain', () => {
  it('translates a free player row (user_id null)', () => {
    expect(mapFreeMatchPlayerRowToDomain(makePlayerRow())).toEqual<FreeMatchPlayer>({
      id: 'p-free',
      matchId: MATCH_ID,
      side: 'A',
      userId: null,
      displayNameSnapshot: 'Alice',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('translates a linked player row (user_id set) on side B', () => {
    const row = makePlayerRow({ id: 'p-linked', side: 'B', user_id: OTHER_ACCOUNT_ID, display_name: 'Bob' })
    expect(mapFreeMatchPlayerRowToDomain(row)).toEqual<FreeMatchPlayer>({
      id: 'p-linked',
      matchId: MATCH_ID,
      side: 'B',
      userId: OTHER_ACCOUNT_ID,
      displayNameSnapshot: 'Bob',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })
})

describe('mapFreeMatchRowToDomain', () => {
  it('translates the row with its embedded players, sorted by snapshot name', () => {
    const row = makeMatchRow([
      makePlayerRow({ id: 'p-zoe', display_name: 'Zoé' }),
      makePlayerRow({ id: 'p-creator', user_id: CREATOR_ID, display_name: 'Moi' }),
      makePlayerRow({ id: 'p-bob', side: 'B', display_name: 'Bob' }),
    ])

    expect(mapFreeMatchRowToDomain(row)).toEqual<FreeMatch>({
      id: MATCH_ID,
      createdBy: CREATOR_ID,
      playedOn: '2026-08-30',
      scoreA: 13,
      scoreB: 7,
      visibility: 'private',
      players: [
        { id: 'p-bob', matchId: MATCH_ID, side: 'B', userId: null, displayNameSnapshot: 'Bob', createdAt: NOW, updatedAt: NOW },
        { id: 'p-creator', matchId: MATCH_ID, side: 'A', userId: CREATOR_ID, displayNameSnapshot: 'Moi', createdAt: NOW, updatedAt: NOW },
        { id: 'p-zoe', matchId: MATCH_ID, side: 'A', userId: null, displayNameSnapshot: 'Zoé', createdAt: NOW, updatedAt: NOW },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('keeps created_by null when the creator account vanished', () => {
    const row = { ...makeMatchRow([]), created_by: null }
    expect(mapFreeMatchRowToDomain(row).createdBy).toBeNull()
    expect(mapFreeMatchRowToDomain(row).players).toEqual([])
  })
})

describe('mapAccountMatchRowToDomain', () => {
  it('translates a lookup row to an AccountMatch', () => {
    expect(
      mapAccountMatchRowToDomain({ user_id: OTHER_ACCOUNT_ID, display_name: 'Bob' }),
    ).toEqual<AccountMatch>({ userId: OTHER_ACCOUNT_ID, displayName: 'Bob' })
  })
})

describe('mapCreateFreeMatchInputToRpcPayload', () => {
  const input: CreateFreeMatchInput = {
    playedOn: null,
    visibility: 'public',
    scoreA: 13,
    scoreB: 11,
    players: [
      { side: 'A', userId: CREATOR_ID, displayName: 'Moi' },
      { side: 'B', userId: null, displayName: 'Bob' },
    ],
  }

  it('maps to the snake_case RPC arguments, passing a null date through', () => {
    expect(mapCreateFreeMatchInputToRpcPayload(input)).toEqual({
      p_played_on: null,
      p_visibility: 'public',
      p_score_a: 13,
      p_score_b: 11,
      p_players: [
        { side: 'A', user_id: CREATOR_ID, display_name: 'Moi' },
        { side: 'B', user_id: null, display_name: 'Bob' },
      ],
    })
  })

  it('passes an explicit date through unchanged', () => {
    expect(mapCreateFreeMatchInputToRpcPayload({ ...input, playedOn: '2026-08-29' }).p_played_on)
      .toBe('2026-08-29')
  })
})
