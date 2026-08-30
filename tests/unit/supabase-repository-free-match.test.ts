import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../app/types/database.types'
import type { CreateFreeMatchInput } from '../../app/types'
import { FreeMatchError } from '../../app/types'
import { SupabaseRepository } from '../../app/repositories/SupabaseRepository'

// Méthodes « match libre » de SupabaseRepository (H2.b), fichier dédié.
// Même technique de mock que supabase-repository.test.ts : un builder
// factice fluent dont le `then` résout vers { data, error } ; pour rpc(), un
// thenable direct.

type ChainResult = {
  data: unknown
  error: { message: string, code?: string } | null
}

type MockChain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (onFulfilled: (value: ChainResult) => unknown) => unknown
}

function makeChainWithResult(result: ChainResult): MockChain {
  const chain: Partial<MockChain> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.delete = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => chain)
  chain.then = onFulfilled => onFulfilled(result)
  return chain as MockChain
}

function makeRepoWithChain(chain: MockChain) {
  const from = vi.fn(() => chain)
  const client = { from } as unknown as SupabaseClient<Database>
  return { repo: new SupabaseRepository(client), from }
}

function makeRepoWithRpcResult(result: ChainResult) {
  const thenable = {
    then: (onFulfilled: (value: ChainResult) => unknown) => onFulfilled(result),
  }
  const rpc = vi.fn(() => thenable)
  const client = { from: vi.fn(), rpc } as unknown as SupabaseClient<Database>
  return { repo: new SupabaseRepository(client), rpc }
}

async function captureError(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation()
    return null
  }
  catch (error) {
    return error
  }
}

const NOW = '2026-01-01T00:00:00.000Z'
const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const CREATOR_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'

function makeMatchRow() {
  return {
    id: MATCH_ID,
    created_by: CREATOR_ID,
    played_on: '2026-08-30',
    score_a: 13,
    score_b: 7,
    visibility: 'private' as const,
    created_at: NOW,
    updated_at: NOW,
    free_match_players: [
      { id: 'p-zoe', match_id: MATCH_ID, side: 'B' as const, user_id: null, display_name: 'Zoé', created_at: NOW, updated_at: NOW },
      { id: 'p-moi', match_id: MATCH_ID, side: 'A' as const, user_id: CREATOR_ID, display_name: 'Moi', created_at: NOW, updated_at: NOW },
    ],
  }
}

const createInput: CreateFreeMatchInput = {
  playedOn: null,
  visibility: 'private',
  scoreA: 13,
  scoreB: 7,
  players: [
    { side: 'A', userId: CREATOR_ID, displayName: 'Moi' },
    { side: 'B', userId: null, displayName: 'Zoé' },
  ],
}

describe('SupabaseRepository — getFreeMatchById', () => {
  it('reads free_matches with the embedded players and maps the row', async () => {
    const chain = makeChainWithResult({ data: makeMatchRow(), error: null })
    const { repo, from } = makeRepoWithChain(chain)

    const freeMatch = await repo.getFreeMatchById(MATCH_ID)

    expect(from).toHaveBeenCalledWith('free_matches')
    expect(chain.select).toHaveBeenCalledWith('*, free_match_players(*)')
    expect(chain.eq).toHaveBeenCalledWith('id', MATCH_ID)
    expect(chain.maybeSingle).toHaveBeenCalled()
    expect(freeMatch?.id).toBe(MATCH_ID)
    expect(freeMatch?.players.map(player => player.displayNameSnapshot)).toEqual(['Moi', 'Zoé'])
  })

  it('returns undefined when the match is not visible (null data, no error)', async () => {
    const { repo } = makeRepoWithChain(makeChainWithResult({ data: null, error: null }))
    expect(await repo.getFreeMatchById(MATCH_ID)).toBeUndefined()
  })

  it('throws a standard Error on a query error', async () => {
    const { repo } = makeRepoWithChain(
      makeChainWithResult({ data: null, error: { message: 'network down' } }),
    )
    const caught = await captureError(() => repo.getFreeMatchById(MATCH_ID))
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('network down')
  })
})

describe('SupabaseRepository — createFreeMatch', () => {
  it('calls the create_free_match RPC with the mapped payload and returns the new id', async () => {
    const { repo, rpc } = makeRepoWithRpcResult({ data: MATCH_ID, error: null })

    const createdId = await repo.createFreeMatch(createInput)

    expect(createdId).toBe(MATCH_ID)
    expect(rpc).toHaveBeenCalledWith('create_free_match', {
      p_played_on: null,
      p_visibility: 'private',
      p_score_a: 13,
      p_score_b: 7,
      p_players: [
        { side: 'A', user_id: CREATOR_ID, display_name: 'Moi' },
        { side: 'B', user_id: null, display_name: 'Zoé' },
      ],
    })
  })

  it.each([
    'not_authenticated',
    'invalid_side',
    'invalid_side_count',
    'unbalanced_sides',
    'duplicate_player',
    'invalid_score',
    'invalid_played_on',
    'player_user_not_found',
  ] as const)('throws FreeMatchError(%s) when the RPC raises that code', async (code) => {
    const { repo } = makeRepoWithRpcResult({ data: null, error: { message: code } })

    const caught = await captureError(() => repo.createFreeMatch(createInput))

    expect(caught).toBeInstanceOf(FreeMatchError)
    expect((caught as FreeMatchError).code).toBe(code)
  })

  it('throws FreeMatchError(unknown) on an unrecognized error message', async () => {
    const { repo } = makeRepoWithRpcResult({
      data: null,
      error: { message: 'new row violates row-level security policy', code: '42501' },
    })

    const caught = await captureError(() => repo.createFreeMatch(createInput))

    expect(caught).toBeInstanceOf(FreeMatchError)
    expect((caught as FreeMatchError).code).toBe('unknown')
  })

  it('throws FreeMatchError(unknown) when the RPC returns no id without error', async () => {
    const { repo } = makeRepoWithRpcResult({ data: null, error: null })

    const caught = await captureError(() => repo.createFreeMatch(createInput))

    expect(caught).toBeInstanceOf(FreeMatchError)
    expect((caught as FreeMatchError).code).toBe('unknown')
  })
})

describe('SupabaseRepository — deleteFreeMatch', () => {
  it('deletes the free_matches row by id', async () => {
    const chain = makeChainWithResult({ data: null, error: null })
    const { repo, from } = makeRepoWithChain(chain)

    await repo.deleteFreeMatch(MATCH_ID)

    expect(from).toHaveBeenCalledWith('free_matches')
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', MATCH_ID)
  })

  it('throws a standard Error on a query error', async () => {
    const { repo } = makeRepoWithChain(
      makeChainWithResult({ data: null, error: { message: 'boom' } }),
    )
    const caught = await captureError(() => repo.deleteFreeMatch(MATCH_ID))
    expect((caught as Error).message).toBe('boom')
  })
})

describe('SupabaseRepository — findAccountByDisplayName', () => {
  it('calls the find_account_by_display_name RPC with the raw input and maps the first row', async () => {
    const { repo, rpc } = makeRepoWithRpcResult({
      data: [{ user_id: OTHER_ACCOUNT_ID, display_name: 'Bob' }],
      error: null,
    })

    const account = await repo.findAccountByDisplayName('  bob ')

    expect(rpc).toHaveBeenCalledWith('find_account_by_display_name', { p_display_name: '  bob ' })
    expect(account).toEqual({ userId: OTHER_ACCOUNT_ID, displayName: 'Bob' })
  })

  it('returns undefined when no account matches (empty array or null data)', async () => {
    const emptyArray = makeRepoWithRpcResult({ data: [], error: null })
    expect(await emptyArray.repo.findAccountByDisplayName('nobody')).toBeUndefined()

    const nullData = makeRepoWithRpcResult({ data: null, error: null })
    expect(await nullData.repo.findAccountByDisplayName('nobody')).toBeUndefined()
  })

  it('throws a standard Error (not a FreeMatchError) on an RPC error', async () => {
    const { repo } = makeRepoWithRpcResult({ data: null, error: { message: 'not_authenticated' } })
    const caught = await captureError(() => repo.findAccountByDisplayName('Bob'))
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(FreeMatchError)
    expect((caught as Error).message).toBe('not_authenticated')
  })
})
