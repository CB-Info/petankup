import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../app/types/database.types'
import type { Match, Tournament, TournamentMember } from '../../app/types'
import { InviteMemberError, ProfileError } from '../../app/types'
import { SupabaseRepository } from '../../app/repositories/SupabaseRepository'

// Mock du client Supabase. Le builder Supabase est un objet PromiseLike :
// chaque méthode (select, eq, upsert, delete, maybeSingle) renvoie le
// builder lui-même pour permettre la fluence ; un `await` déclenche
// finalement la résolution via la méthode `then`.
//
// Notre helper `makeChainWithResult` construit un builder factice dont
// toutes les méthodes sont des `vi.fn()` espionnables, et dont le `then`
// résout au { data, error } passé en paramètre.

type ChainResult = {
  data: unknown
  error: { message: string, code?: string } | null
}

type MockChain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  then: (onFulfilled: (value: ChainResult) => unknown) => unknown
}

function makeChainWithResult(result: ChainResult): MockChain {
  const chain: Partial<MockChain> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.upsert = vi.fn(() => chain)
  chain.delete = vi.fn(() => chain)
  chain.update = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => chain)
  chain.single = vi.fn(() => chain)
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

// Helper dédié pour client.rpc(name, args) : à la différence de
// client.from(...), pas de chaînage intermédiaire — la valeur retournée
// est directement awaitable (thenable) et résout vers { data, error }.
function makeRepoWithRpcResult(result: ChainResult): {
  repo: SupabaseRepository
  rpc: ReturnType<typeof vi.fn>
} {
  const thenable = {
    then: (onFulfilled: (value: ChainResult) => unknown) => onFulfilled(result),
  }
  const rpc = vi.fn(() => thenable)
  // Les tests RPC ne touchent pas à client.from, mais on l'expose comme
  // no-op pour rester compatible avec le typage SupabaseClient<Database>.
  const from = vi.fn()
  const client = { from, rpc } as unknown as SupabaseClient<Database>
  return { repo: new SupabaseRepository(client), rpc }
}

// Helper pour les RPCs qui écrivent puis refetch (createTeam / updateTeam) :
// rpc() résout vers rpcResult, et from() vers un chain résolvant chainResult.
function makeRepoWithRpcAndChain(rpcResult: ChainResult, chainResult: ChainResult): {
  repo: SupabaseRepository
  rpc: ReturnType<typeof vi.fn>
  from: ReturnType<typeof vi.fn>
  chain: MockChain
} {
  const rpcThenable = {
    then: (onFulfilled: (value: ChainResult) => unknown) => onFulfilled(rpcResult),
  }
  const rpc = vi.fn(() => rpcThenable)
  const chain = makeChainWithResult(chainResult)
  const from = vi.fn(() => chain)
  const client = { from, rpc } as unknown as SupabaseClient<Database>
  return { repo: new SupabaseRepository(client), rpc, from, chain }
}

const NOW = '2026-01-01T00:00:00.000Z'
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const TOURNAMENT_ID = '22222222-2222-4222-8222-222222222222'
const TEAM_A_ID = '33333333-3333-4333-8333-333333333333'
const TEAM_B_ID = '44444444-4444-4444-8444-444444444444'
const MATCH_ID = '55555555-5555-4555-8555-555555555555'
const MEMBER_ID = '66666666-6666-4666-8666-666666666666'
const INVITEE_USER_ID = '77777777-7777-4777-8777-777777777777'

function makeMemberRow() {
  return {
    id: MEMBER_ID,
    tournament_id: TOURNAMENT_ID,
    user_id: INVITEE_USER_ID,
    member_email: 'guest@example.com',
    created_at: NOW,
    updated_at: NOW,
  }
}

function makeTournamentRow() {
  return {
    id: TOURNAMENT_ID,
    name: 'Tournoi',
    date: '2026-05-10',
    location: null,
    description: null,
    format: 'round_robin' as const,
    status: 'draft' as const,
    visibility: 'private' as const,
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
    visibility: 'private',
    ownerId: OWNER_ID,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeTeamPlayerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    team_id: TEAM_A_ID,
    tournament_id: TOURNAMENT_ID,
    user_id: null,
    display_name: 'Alice',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

// teams est toujours lu avec l'embed team_players(*).
function makeTeamRow() {
  return {
    id: TEAM_A_ID,
    tournament_id: TOURNAMENT_ID,
    name: 'Les Boulistes',
    created_at: NOW,
    updated_at: NOW,
    team_players: [makeTeamPlayerRow()],
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
        visibility: 'private',
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
    expect(chain.select).toHaveBeenCalledWith('*, team_players(*)')
    expect(chain.eq).toHaveBeenCalledWith('tournament_id', TOURNAMENT_ID)
    expect(teams).toHaveLength(1)
    expect(teams[0]!.tournamentId).toBe(TOURNAMENT_ID)
    expect(teams[0]!.players).toHaveLength(1)
    expect(teams[0]!.players[0]!.displayNameSnapshot).toBe('Alice')
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({ data: null, error: { message: 'teams failed' } })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.getTeamsByTournament('any')).rejects.toThrow('teams failed')
  })
})

describe('SupabaseRepository — createTeam', () => {
  it('calls the RPC with mapped players and refetches the full team', async () => {
    const { repo, rpc, from, chain } = makeRepoWithRpcAndChain(
      { data: TEAM_A_ID, error: null },
      { data: makeTeamRow(), error: null },
    )

    const team = await repo.createTeam(TOURNAMENT_ID, 'Les Boulistes', [
      { userId: null, displayName: 'Alice' },
      { userId: INVITEE_USER_ID, displayName: 'Bob' },
    ])

    expect(rpc).toHaveBeenCalledWith('create_team_with_players', {
      p_tournament_id: TOURNAMENT_ID,
      p_name: 'Les Boulistes',
      p_players: [
        { user_id: null, display_name: 'Alice' },
        { user_id: INVITEE_USER_ID, display_name: 'Bob' },
      ],
    })
    // Refetch ciblé de l'équipe complète.
    expect(from).toHaveBeenCalledWith('teams')
    expect(chain.select).toHaveBeenCalledWith('*, team_players(*)')
    expect(chain.eq).toHaveBeenCalledWith('id', TEAM_A_ID)
    expect(chain.single).toHaveBeenCalled()
    expect(team.id).toBe(TEAM_A_ID)
    expect(team.players).toHaveLength(1)
  })

  it('throws when the RPC returns an error', async () => {
    const { repo } = makeRepoWithRpcAndChain(
      { data: null, error: { message: 'not_owner raised by RPC' } },
      { data: null, error: null },
    )

    await expect(
      repo.createTeam(TOURNAMENT_ID, 'X', [{ userId: null, displayName: 'A' }]),
    ).rejects.toThrow('not_owner raised by RPC')
  })

  it('throws when the RPC returns a null team id', async () => {
    const { repo } = makeRepoWithRpcAndChain(
      { data: null, error: null },
      { data: null, error: null },
    )

    await expect(
      repo.createTeam(TOURNAMENT_ID, 'X', [{ userId: null, displayName: 'A' }]),
    ).rejects.toThrow('create_team_with_players returned null')
  })
})

describe('SupabaseRepository — updateTeam', () => {
  it('calls the RPC with team id + mapped players and refetches', async () => {
    const { repo, rpc, chain } = makeRepoWithRpcAndChain(
      { data: TEAM_A_ID, error: null },
      { data: makeTeamRow(), error: null },
    )

    const team = await repo.updateTeam(TEAM_A_ID, 'Renommée', [
      { userId: null, displayName: 'Alice' },
    ])

    expect(rpc).toHaveBeenCalledWith('update_team_with_players', {
      p_team_id: TEAM_A_ID,
      p_name: 'Renommée',
      p_players: [{ user_id: null, display_name: 'Alice' }],
    })
    expect(chain.eq).toHaveBeenCalledWith('id', TEAM_A_ID)
    expect(team.id).toBe(TEAM_A_ID)
  })

  it('throws when the RPC returns an error', async () => {
    const { repo } = makeRepoWithRpcAndChain(
      { data: null, error: { message: 'team_not_found raised by RPC' } },
      { data: null, error: null },
    )

    await expect(
      repo.updateTeam(TEAM_A_ID, 'X', [{ userId: null, displayName: 'A' }]),
    ).rejects.toThrow('team_not_found raised by RPC')
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

// --- Tournament members ---

describe('SupabaseRepository — getMembersByTournament', () => {
  it('filters by tournament_id and maps rows', async () => {
    const chain = makeChainWithResult({ data: [makeMemberRow()], error: null })
    const { repo, from } = makeRepoWithChain(chain)

    const members = await repo.getMembersByTournament(TOURNAMENT_ID)

    expect(from).toHaveBeenCalledWith('tournament_members')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('tournament_id', TOURNAMENT_ID)
    expect(members).toHaveLength(1)
    expect(members[0]!.id).toBe(MEMBER_ID)
    expect(members[0]!.tournamentId).toBe(TOURNAMENT_ID)
    expect(members[0]!.userId).toBe(INVITEE_USER_ID)
    expect(members[0]!.memberEmail).toBe('guest@example.com')
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({
      data: null,
      error: { message: 'members lookup failed' },
    })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.getMembersByTournament('any')).rejects.toThrow(
      'members lookup failed',
    )
  })
})

describe('SupabaseRepository — getMyMemberships', () => {
  it('filters by user_id and maps rows', async () => {
    const chain = makeChainWithResult({ data: [makeMemberRow()], error: null })
    const { repo, from } = makeRepoWithChain(chain)

    const memberships = await repo.getMyMemberships(INVITEE_USER_ID)

    expect(from).toHaveBeenCalledWith('tournament_members')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('user_id', INVITEE_USER_ID)
    expect(memberships).toHaveLength(1)
    expect(memberships[0]!.userId).toBe(INVITEE_USER_ID)
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({
      data: null,
      error: { message: 'memberships lookup failed' },
    })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.getMyMemberships('any')).rejects.toThrow(
      'memberships lookup failed',
    )
  })
})

describe('SupabaseRepository — inviteMemberByDisplayName', () => {
  it('calls rpc(invite_tournament_member_by_display_name) with the provided tournament id and display name and maps the inserted row', async () => {
    const { repo, rpc } = makeRepoWithRpcResult({
      data: makeMemberRow(),
      error: null,
    })

    const inserted = await repo.inviteMemberByDisplayName(
      TOURNAMENT_ID,
      'Bob',
    )

    expect(rpc).toHaveBeenCalledWith(
      'invite_tournament_member_by_display_name',
      {
        p_tournament_id: TOURNAMENT_ID,
        p_display_name: 'Bob',
      },
    )
    expect(inserted).toEqual<TournamentMember>({
      id: MEMBER_ID,
      tournamentId: TOURNAMENT_ID,
      userId: INVITEE_USER_ID,
      memberEmail: 'guest@example.com',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('passes the display name through without normalisation (DB does lower(trim))', async () => {
    const { repo, rpc } = makeRepoWithRpcResult({
      data: makeMemberRow(),
      error: null,
    })

    await repo.inviteMemberByDisplayName(TOURNAMENT_ID, '  Bob  ')

    expect(rpc).toHaveBeenCalledWith(
      'invite_tournament_member_by_display_name',
      {
        p_tournament_id: TOURNAMENT_ID,
        p_display_name: '  Bob  ',
      },
    )
  })

  it.each([
    'display_name_not_found',
    'already_member',
    'self_invite',
    'not_owner',
    'not_authenticated',
    'tournament_completed',
  ] as const)(
    'throws InviteMemberError(%s) when rpc error message contains the code',
    async (code) => {
      const { repo } = makeRepoWithRpcResult({
        data: null,
        error: { message: `error: ${code} raised by RPC` },
      })

      let caught: unknown = null
      try {
        await repo.inviteMemberByDisplayName(TOURNAMENT_ID, 'Bob')
      }
      catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(InviteMemberError)
      expect((caught as InviteMemberError).code).toBe(code)
    },
  )

  it('throws InviteMemberError(unknown) when rpc error message is unrecognized', async () => {
    const { repo } = makeRepoWithRpcResult({
      data: null,
      error: { message: 'connection reset by peer' },
    })

    let caught: unknown = null
    try {
      await repo.inviteMemberByDisplayName(TOURNAMENT_ID, 'Bob')
    }
    catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InviteMemberError)
    expect((caught as InviteMemberError).code).toBe('unknown')
  })

  it('throws InviteMemberError(unknown) when rpc returns null data without error', async () => {
    const { repo } = makeRepoWithRpcResult({ data: null, error: null })

    let caught: unknown = null
    try {
      await repo.inviteMemberByDisplayName(TOURNAMENT_ID, 'Bob')
    }
    catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InviteMemberError)
    expect((caught as InviteMemberError).code).toBe('unknown')
  })
})

describe('SupabaseRepository — removeMember', () => {
  it('calls the remove_tournament_member RPC with the member id', async () => {
    const { repo, rpc } = makeRepoWithRpcResult({ data: null, error: null })

    await repo.removeMember(MEMBER_ID)

    expect(rpc).toHaveBeenCalledWith('remove_tournament_member', {
      p_member_id: MEMBER_ID,
    })
  })

  it.each([
    'member_in_team',
    'not_owner',
    'tournament_completed',
    'not_authenticated',
  ] as const)(
    'throws InviteMemberError(%s) when the RPC raises that code',
    async (code) => {
      const { repo } = makeRepoWithRpcResult({
        data: null,
        error: { message: `error: ${code} raised by RPC` },
      })

      let caught: unknown = null
      try {
        await repo.removeMember(MEMBER_ID)
      }
      catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(InviteMemberError)
      expect((caught as InviteMemberError).code).toBe(code)
    },
  )

  it('throws InviteMemberError(unknown) for an unrecognized RPC error', async () => {
    const { repo } = makeRepoWithRpcResult({
      data: null,
      error: { message: 'connection reset by peer' },
    })

    let caught: unknown = null
    try {
      await repo.removeMember(MEMBER_ID)
    }
    catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InviteMemberError)
    expect((caught as InviteMemberError).code).toBe('unknown')
  })
})

// --- Profiles ---

function makeProfileRow(overrides: Partial<{ id: string, display_name: string }> = {}) {
  return {
    id: overrides.id ?? OWNER_ID,
    display_name: overrides.display_name ?? 'Alice',
    created_at: NOW,
    updated_at: NOW,
  }
}

describe('SupabaseRepository — getProfileById', () => {
  it('returns the mapped profile when the row exists', async () => {
    const chain = makeChainWithResult({ data: makeProfileRow(), error: null })
    const { repo, from } = makeRepoWithChain(chain)

    const profile = await repo.getProfileById(OWNER_ID)

    expect(from).toHaveBeenCalledWith('profiles')
    expect(chain.eq).toHaveBeenCalledWith('id', OWNER_ID)
    expect(chain.maybeSingle).toHaveBeenCalled()
    expect(profile).toEqual({
      id: OWNER_ID,
      displayName: 'Alice',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('returns undefined when the row is not visible (RLS) or absent', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo } = makeRepoWithChain(chain)

    expect(await repo.getProfileById('missing')).toBeUndefined()
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({
      data: null,
      error: { message: 'profile fetch failed' },
    })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.getProfileById(OWNER_ID)).rejects.toThrow('profile fetch failed')
  })
})

describe('SupabaseRepository — getProfilesByIds', () => {
  it('returns [] without touching the client when ids is empty', async () => {
    const chain = makeChainWithResult({ data: [], error: null })
    const { repo, from } = makeRepoWithChain(chain)

    expect(await repo.getProfilesByIds([])).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('deduplicates ids before calling .in', async () => {
    const chain = makeChainWithResult({
      data: [makeProfileRow({ id: OWNER_ID }), makeProfileRow({ id: INVITEE_USER_ID, display_name: 'Bob' })],
      error: null,
    })
    const { repo, from } = makeRepoWithChain(chain)

    await repo.getProfilesByIds([OWNER_ID, OWNER_ID, INVITEE_USER_ID])

    expect(from).toHaveBeenCalledWith('profiles')
    expect(chain.in).toHaveBeenCalledTimes(1)
    const [column, values] = chain.in.mock.calls[0]!
    expect(column).toBe('id')
    expect(values).toHaveLength(2)
    expect(values).toEqual(expect.arrayContaining([OWNER_ID, INVITEE_USER_ID]))
  })

  it('maps the returned rows to Profile[]', async () => {
    const chain = makeChainWithResult({
      data: [
        makeProfileRow({ id: OWNER_ID, display_name: 'Alice' }),
        makeProfileRow({ id: INVITEE_USER_ID, display_name: 'Bob' }),
      ],
      error: null,
    })
    const { repo } = makeRepoWithChain(chain)

    const profiles = await repo.getProfilesByIds([OWNER_ID, INVITEE_USER_ID])
    expect(profiles).toEqual([
      { id: OWNER_ID, displayName: 'Alice', createdAt: NOW, updatedAt: NOW },
      { id: INVITEE_USER_ID, displayName: 'Bob', createdAt: NOW, updatedAt: NOW },
    ])
  })

  it('returns [] when data is null (no row matches RLS)', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo } = makeRepoWithChain(chain)

    expect(await repo.getProfilesByIds([OWNER_ID])).toEqual([])
  })

  it('throws when Supabase returns an error', async () => {
    const chain = makeChainWithResult({
      data: null,
      error: { message: 'profiles batch failed' },
    })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.getProfilesByIds([OWNER_ID])).rejects.toThrow(
      'profiles batch failed',
    )
  })
})

describe('SupabaseRepository — updateMyProfile', () => {
  it('updates display_name for the given user and returns the mapped row', async () => {
    const chain = makeChainWithResult({
      data: makeProfileRow({ display_name: 'Alice (updated)' }),
      error: null,
    })
    const { repo, from } = makeRepoWithChain(chain)

    const profile = await repo.updateMyProfile(OWNER_ID, 'Alice (updated)')

    expect(from).toHaveBeenCalledWith('profiles')
    expect(chain.update).toHaveBeenCalledWith({ display_name: 'Alice (updated)' })
    expect(chain.eq).toHaveBeenCalledWith('id', OWNER_ID)
    expect(chain.select).toHaveBeenCalled()
    expect(chain.single).toHaveBeenCalled()
    expect(profile).toEqual({
      id: OWNER_ID,
      displayName: 'Alice (updated)',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('throws when Supabase returns an error (RLS denial or CHECK violation)', async () => {
    const chain = makeChainWithResult({
      data: null,
      error: { message: 'new row violates row-level security policy' },
    })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.updateMyProfile(OWNER_ID, 'X')).rejects.toThrow(
      'new row violates row-level security policy',
    )
  })

  it('throws ProfileError(display_name_taken) on 23505 over the display_name index', async () => {
    const chain = makeChainWithResult({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "profiles_display_name_lower_idx"',
      },
    })
    const { repo } = makeRepoWithChain(chain)

    let caught: unknown
    try {
      await repo.updateMyProfile(OWNER_ID, 'Alice')
    }
    catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ProfileError)
    expect((caught as ProfileError).code).toBe('display_name_taken')
  })

  it('throws a generic Error (not ProfileError) on 23505 over a different unique index', async () => {
    const chain = makeChainWithResult({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "some_other_unique_idx"',
      },
    })
    const { repo } = makeRepoWithChain(chain)

    let caught: unknown
    try {
      await repo.updateMyProfile(OWNER_ID, 'Alice')
    }
    catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(ProfileError)
  })

  it('throws a generic Error for non-unique-violation Supabase errors', async () => {
    const chain = makeChainWithResult({
      data: null,
      error: { code: 'PGRST116', message: 'some other error' },
    })
    const { repo } = makeRepoWithChain(chain)

    await expect(repo.updateMyProfile(OWNER_ID, 'Alice')).rejects.toThrow(
      'some other error',
    )
    await expect(
      repo.updateMyProfile(OWNER_ID, 'Alice'),
    ).rejects.not.toBeInstanceOf(ProfileError)
  })
})
