import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../app/types/database.types'
import { FriendshipError } from '../../app/types'
import { SupabaseRepository } from '../../app/repositories/SupabaseRepository'

// Méthodes « amitié » de SupabaseRepository (A3), fichier dédié. Même
// technique de mock que supabase-repository-free-match.test.ts : pour
// rpc(), un thenable direct qui résout vers { data, error }.

type ChainResult = {
  data: unknown
  error: { message: string, code?: string } | null
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

const TARGET_USER_ID = '22222222-2222-4222-8222-222222222222'

describe('getFriendships', () => {
  it('calls the RPC and maps the three lists', async () => {
    const { repo, rpc } = makeRepoWithRpcResult({
      data: {
        friends: [{ user_id: 'u1', display_name: 'Alice' }],
        received: [],
        sent: [{ user_id: 'u2', display_name: 'Bob' }],
      },
      error: null,
    })

    const bundle = await repo.getFriendships()

    expect(rpc).toHaveBeenCalledWith('get_friendships')
    expect(bundle.friends).toEqual([{ userId: 'u1', displayName: 'Alice' }])
    expect(bundle.received).toEqual([])
    expect(bundle.sent).toEqual([{ userId: 'u2', displayName: 'Bob' }])
  })

  it('maps a raised code to a typed FriendshipError', async () => {
    const { repo } = makeRepoWithRpcResult({
      data: null,
      error: { message: 'not_authenticated' },
    })

    const error = await captureError(() => repo.getFriendships())

    expect(error).toBeInstanceOf(FriendshipError)
    expect((error as FriendshipError).code).toBe('not_authenticated')
  })

  it('treats a null payload as unknown', async () => {
    const { repo } = makeRepoWithRpcResult({ data: null, error: null })

    const error = await captureError(() => repo.getFriendships())

    expect(error).toBeInstanceOf(FriendshipError)
    expect((error as FriendshipError).code).toBe('unknown')
  })
})

describe('requestFriendship', () => {
  it('passes the display name and returns the outcome', async () => {
    const { repo, rpc } = makeRepoWithRpcResult({ data: 'pending', error: null })

    const outcome = await repo.requestFriendship('Alice')

    expect(rpc).toHaveBeenCalledWith('request_friendship', { p_display_name: 'Alice' })
    expect(outcome).toBe('pending')
  })

  it('returns accepted on a crossed request', async () => {
    const { repo } = makeRepoWithRpcResult({ data: 'accepted', error: null })
    expect(await repo.requestFriendship('Alice')).toBe('accepted')
  })

  it('maps raised codes and guards the outcome shape', async () => {
    const { repo: failing } = makeRepoWithRpcResult({
      data: null,
      error: { message: 'already_friends' },
    })
    const raised = await captureError(() => failing.requestFriendship('Alice'))
    expect((raised as FriendshipError).code).toBe('already_friends')

    const { repo: malformed } = makeRepoWithRpcResult({ data: 42, error: null })
    const shapeError = await captureError(() => malformed.requestFriendship('Alice'))
    expect((shapeError as FriendshipError).code).toBe('unknown')
  })
})

describe('les quatre actions ciblant une personne', () => {
  const actions = [
    ['accept_friendship', (repo: SupabaseRepository) => repo.acceptFriendship(TARGET_USER_ID)],
    ['refuse_friendship', (repo: SupabaseRepository) => repo.refuseFriendship(TARGET_USER_ID)],
    ['cancel_friendship_request', (repo: SupabaseRepository) => repo.cancelFriendshipRequest(TARGET_USER_ID)],
    ['remove_friendship', (repo: SupabaseRepository) => repo.removeFriendship(TARGET_USER_ID)],
  ] as const

  it.each(actions)('%s passe p_user_id et résout sans valeur', async (rpcName, invoke) => {
    const { repo, rpc } = makeRepoWithRpcResult({ data: null, error: null })

    await invoke(repo)

    expect(rpc).toHaveBeenCalledWith(rpcName, { p_user_id: TARGET_USER_ID })
  })

  it.each(actions)('%s mappe un code levé en FriendshipError', async (_rpcName, invoke) => {
    const { repo } = makeRepoWithRpcResult({
      data: null,
      error: { message: 'request_not_found' },
    })

    const error = await captureError(() => invoke(repo))

    expect(error).toBeInstanceOf(FriendshipError)
    expect((error as FriendshipError).code).toBe('request_not_found')
  })
})
