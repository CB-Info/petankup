import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../app/types/database.types'
import type { Match, Team, Tournament } from '../../app/types'
import { SupabaseRepository } from '../../app/repositories/SupabaseRepository'

// Mock du client Supabase. Le builder Supabase est un objet PromiseLike :
// chaque méthode (select, eq, upsert, delete, maybeSingle) renvoie le
// builder lui-même pour permettre la fluence ; un `await` déclenche
// finalement la résolution via la méthode `then`.
//
// Notre helper `makeChainWithResult` construit un builder factice dont
// toutes les méthodes sont des `vi.fn()` espionnables, et dont le `then`
// résout au { data, error } passé en paramètre.

type ChainResult = { data: unknown, error: { message: string } | null }

type MockChain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (onFulfilled: (value: ChainResult) => unknown) => unknown
}

function makeChainWithResult(result: ChainResult): MockChain {
  const chain: Partial<MockChain> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.upsert = vi.fn(() => chain)
  chain.delete = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => chain)
  chain.then = onFulfilled => onFulfilled(result)
  return chain as MockChain
}

function makeRepoWithChain(chain: MockChain): {
  repo: SupabaseRepository
  from: ReturnType<typeof vi.fn>
} {
  const from = vi.fn(() => chain)
  const client = { from } as unknown as SupabaseClient<Database>
  return { repo: new SupabaseRepository(client), from }
}

const NOW = '2026-01-01T00:00:00.000Z'
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const TOURNAMENT_ID = '22222222-2222-4222-8222-222222222222'
const TEAM_A_ID = '33333333-3333-4333-8333-333333333333'
const TEAM_B_ID = '44444444-4444-4444-8444-444444444444'
const MATCH_ID = '55555555-5555-4555-8555-555555555555'

function makeTournamentRow() {
  return {
    id: TOURNAMENT_ID,
    name: 'Tournoi',
    date: '2026-05-10',
    location: null,
    description: null,
    format: 'round_robin' as const,
    status: 'draft' as const,
    owner_id: OWNER_ID,
    created_at: NOW,
    updated_at: NOW,
  }
}

function makeTournamentDomain(): Tournament {
  return {
    id: TOURNAMENT_ID,
    name: 'Tournoi',
    date: '2026-05-10',
    format: 'round_robin',
    status: 'draft',
    ownerId: OWNER_ID,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeTeamRow() {
  return {
    id: TEAM_A_ID,
    tournament_id: TOURNAMENT_ID,
    name: 'Les Boulistes',
    players: ['Alice', 'Bob'],
    created_at: NOW,
    updated_at: NOW,
  }
}

function makeTeamDomain(): Team {
  return {
    id: TEAM_A_ID,
    tournamentId: TOURNAMENT_ID,
    name: 'Les Boulistes',
    players: ['Alice', 'Bob'],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeMatchRow() {
  return {
    id: MATCH_ID,
    tournament_id: TOURNAMENT_ID,
    team_a_id: TEAM_A_ID,
    team_b_id: TEAM_B_ID,
    score_a: null,
    score_b: null,
    winner_id: null,
    status: 'pending' as const,
    round_number: 1,
    created_at: NOW,
    updated_at: NOW,
  }
}

function makeMatchDomain(): Match {
  return {
    id: MATCH_ID,
    tournamentId: TOURNAMENT_ID,
    teamAId: TEAM_A_ID,
    teamBId: TEAM_B_ID,
    scoreA: null,
    scoreB: null,
    winnerId: null,
    status: 'pending',
    roundNumber: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// --- Tournaments ---

describe('SupabaseRepository — getAllTournaments', () => {
  it('queries the tournaments table and maps rows to domain objects', async () => {
    const chain = makeChainWithResult({ data: [makeTournamentRow()], error: null })
    const { repo, from } = makeRepoWithChain(chain)

    const tournaments = await repo.getAllTournaments()

    expect(from).toHaveBeenCalledWith('tournaments')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(tournaments).toHaveLength(1)
    expect(tournaments[0]!.ownerId).toBe(OWNER_ID)
    expect(tournaments[0]!.id).toBe(TOURNAMENT_ID)
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'select failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.getAllTournaments()).rejects.toThrow('select failed')
  })
})

describe('SupabaseRepository — getTournamentById', () => {
  it('filters by id and returns a single mapped tournament', async () => {
    const chain = makeChainWithResult({ data: makeTournamentRow(), error: null })
    const { repo, from } = makeRepoWithChain(chain)

    const tournament = await repo.getTournamentById(TOURNAMENT_ID)

    expect(from).toHaveBeenCalledWith('tournaments')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('id', TOURNAMENT_ID)
    expect(chain.maybeSingle).toHaveBeenCalled()
    expect(tournament?.id).toBe(TOURNAMENT_ID)
  })

  it('returns undefined when no tournament matches', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo } = makeRepoWithChain(chain)

    expect(await repo.getTournamentById('does-not-exist')).toBeUndefined()
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'lookup failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.getTournamentById('any')).rejects.toThrow('lookup failed')
  })
})

describe('SupabaseRepository — saveTournament', () => {
  it('upserts the tournament with the mapped Insert payload', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo, from } = makeRepoWithChain(chain)

    await repo.saveTournament(makeTournamentDomain())

    expect(from).toHaveBeenCalledWith('tournaments')
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TOURNAMENT_ID,
        owner_id: OWNER_ID,
        name: 'Tournoi',
        format: 'round_robin',
        status: 'draft',
      }),
    )
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'upsert failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.saveTournament(makeTournamentDomain())).rejects.toThrow('upsert failed')
  })
})

describe('SupabaseRepository — deleteTournament', () => {
  it('deletes the row by id (cascade handled by DB)', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo, from } = makeRepoWithChain(chain)

    await repo.deleteTournament(TOURNAMENT_ID)

    expect(from).toHaveBeenCalledWith('tournaments')
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', TOURNAMENT_ID)
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'delete failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.deleteTournament('any')).rejects.toThrow('delete failed')
  })
})

// --- Teams ---

describe('SupabaseRepository — getTeamsByTournament', () => {
  it('filters by tournament_id and maps rows', async () => {
    const chain = makeChainWithResult({ data: [makeTeamRow()], error: null })
    const { repo, from } = makeRepoWithChain(chain)

    const teams = await repo.getTeamsByTournament(TOURNAMENT_ID)

    expect(from).toHaveBeenCalledWith('teams')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('tournament_id', TOURNAMENT_ID)
    expect(teams).toHaveLength(1)
    expect(teams[0]!.tournamentId).toBe(TOURNAMENT_ID)
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'teams failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.getTeamsByTournament('any')).rejects.toThrow('teams failed')
  })
})

describe('SupabaseRepository — saveTeam', () => {
  it('upserts the team with the mapped Insert payload', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo, from } = makeRepoWithChain(chain)

    await repo.saveTeam(makeTeamDomain())

    expect(from).toHaveBeenCalledWith('teams')
    expect(chain.upsert).toHaveBeenCalledWith({
      id: TEAM_A_ID,
      tournament_id: TOURNAMENT_ID,
      name: 'Les Boulistes',
      players: ['Alice', 'Bob'],
    })
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'team upsert failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.saveTeam(makeTeamDomain())).rejects.toThrow('team upsert failed')
  })
})

describe('SupabaseRepository — deleteTeam', () => {
  it('deletes the team by id (cascade handled by DB)', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo, from } = makeRepoWithChain(chain)

    await repo.deleteTeam(TEAM_A_ID)

    expect(from).toHaveBeenCalledWith('teams')
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', TEAM_A_ID)
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'team delete failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.deleteTeam('any')).rejects.toThrow('team delete failed')
  })
})

// --- Matches ---

describe('SupabaseRepository — getMatchesByTournament', () => {
  it('filters by tournament_id and maps rows', async () => {
    const chain = makeChainWithResult({ data: [makeMatchRow()], error: null })
    const { repo, from } = makeRepoWithChain(chain)

    const matches = await repo.getMatchesByTournament(TOURNAMENT_ID)

    expect(from).toHaveBeenCalledWith('matches')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('tournament_id', TOURNAMENT_ID)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.roundNumber).toBe(1)
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'matches failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.getMatchesByTournament('any')).rejects.toThrow('matches failed')
  })
})

describe('SupabaseRepository — saveMatch', () => {
  it('upserts the match with the mapped Insert payload', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo, from } = makeRepoWithChain(chain)

    await repo.saveMatch(makeMatchDomain())

    expect(from).toHaveBeenCalledWith('matches')
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: MATCH_ID,
        tournament_id: TOURNAMENT_ID,
        team_a_id: TEAM_A_ID,
        team_b_id: TEAM_B_ID,
        round_number: 1,
        status: 'pending',
      }),
    )
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'match upsert failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.saveMatch(makeMatchDomain())).rejects.toThrow('match upsert failed')
  })
})

describe('SupabaseRepository — saveMatches (batch)', () => {
  it('upserts an array of mapped Insert payloads', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo, from } = makeRepoWithChain(chain)
    const firstMatch = makeMatchDomain()
    const secondMatch: Match = { ...firstMatch, id: 'other', roundNumber: 2 }

    await repo.saveMatches([firstMatch, secondMatch])

    expect(from).toHaveBeenCalledWith('matches')
    const upsertArg = chain.upsert.mock.calls[0]![0] as Array<{ id: string, round_number: number }>
    expect(upsertArg).toHaveLength(2)
    expect(upsertArg[0]!.id).toBe(MATCH_ID)
    expect(upsertArg[1]!.id).toBe('other')
    expect(upsertArg[1]!.round_number).toBe(2)
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'batch failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.saveMatches([makeMatchDomain()])).rejects.toThrow('batch failed')
  })
})
