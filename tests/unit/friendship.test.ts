import { describe, expect, it } from 'vitest'
import type { FriendshipBundle, FriendshipEntry } from '../../app/types'
import {
  deriveFriendshipStatus,
  friendshipSearchOutcome,
  withFriendInsertedAlphabetically,
  withFriendshipEntryRemoved,
} from '../../app/utils/friendship'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const FRIEND_ID = '22222222-2222-4222-8222-222222222222'
const SENT_ID = '33333333-3333-4333-8333-333333333333'
const RECEIVED_ID = '44444444-4444-4444-8444-444444444444'
const STRANGER_ID = '55555555-5555-4555-8555-555555555555'

function makeEntry(userId: string, displayName: string): FriendshipEntry {
  return { userId, displayName }
}

function makeBundle(overrides: Partial<FriendshipBundle> = {}): FriendshipBundle {
  return {
    friends: [makeEntry(FRIEND_ID, 'Alice')],
    sent: [makeEntry(SENT_ID, 'Jeanne')],
    received: [makeEntry(RECEIVED_ID, 'Paul')],
    ...overrides,
  }
}

describe('deriveFriendshipStatus', () => {
  it('recognizes self before anything else', () => {
    expect(deriveFriendshipStatus(makeBundle(), VIEWER_ID, VIEWER_ID)).toBe('self')
  })

  it('recognizes self even without a loaded bundle', () => {
    expect(deriveFriendshipStatus(null, VIEWER_ID, VIEWER_ID)).toBe('self')
  })

  it('finds a friend, a sent request and a received request', () => {
    const bundle = makeBundle()
    expect(deriveFriendshipStatus(bundle, VIEWER_ID, FRIEND_ID)).toBe('friends')
    expect(deriveFriendshipStatus(bundle, VIEWER_ID, SENT_ID)).toBe('request_sent')
    expect(deriveFriendshipStatus(bundle, VIEWER_ID, RECEIVED_ID)).toBe('request_received')
  })

  it('returns none for a stranger', () => {
    expect(deriveFriendshipStatus(makeBundle(), VIEWER_ID, STRANGER_ID)).toBe('none')
  })

  it('asserts nothing when the bundle is not loaded (null → none)', () => {
    expect(deriveFriendshipStatus(null, VIEWER_ID, FRIEND_ID)).toBe('none')
  })
})

describe('friendshipSearchOutcome', () => {
  const account = { userId: STRANGER_ID, displayName: 'Chloé' }

  it('stays idle before any search', () => {
    expect(friendshipSearchOutcome(false, null, 'none')).toBe('idle')
  })

  it('reports not_found as a nominal case (never an error)', () => {
    expect(friendshipSearchOutcome(true, null, 'none')).toBe('not_found')
  })

  it('passes the relationship status through for a found account', () => {
    expect(friendshipSearchOutcome(true, account, 'none')).toBe('none')
    expect(friendshipSearchOutcome(true, account, 'friends')).toBe('friends')
    expect(friendshipSearchOutcome(true, account, 'request_sent')).toBe('request_sent')
    expect(friendshipSearchOutcome(true, account, 'request_received')).toBe('request_received')
    expect(friendshipSearchOutcome(true, account, 'self')).toBe('self')
  })
})

describe('withFriendshipEntryRemoved', () => {
  it('removes the matching entry and leaves the others in order', () => {
    const entries = [makeEntry('a', 'Alice'), makeEntry('b', 'Bob'), makeEntry('c', 'Chloé')]
    expect(withFriendshipEntryRemoved(entries, 'b')).toEqual([
      makeEntry('a', 'Alice'),
      makeEntry('c', 'Chloé'),
    ])
  })

  it('is a no-op when the entry is absent', () => {
    const entries = [makeEntry('a', 'Alice')]
    expect(withFriendshipEntryRemoved(entries, 'z')).toEqual(entries)
  })
})

describe('withFriendInsertedAlphabetically', () => {
  it('inserts at the alphabetical position, case-insensitively', () => {
    const friends = [makeEntry('a', 'alice'), makeEntry('c', 'Chloé')]
    const inserted = withFriendInsertedAlphabetically(friends, makeEntry('b', 'Bob'))
    expect(inserted.map(entry => entry.displayName)).toEqual(['alice', 'Bob', 'Chloé'])
  })

  it('appends when the new friend sorts last', () => {
    const friends = [makeEntry('a', 'Alice')]
    const inserted = withFriendInsertedAlphabetically(friends, makeEntry('z', 'Zoé'))
    expect(inserted.map(entry => entry.displayName)).toEqual(['Alice', 'Zoé'])
  })

  it('handles an empty list', () => {
    expect(withFriendInsertedAlphabetically([], makeEntry('a', 'Alice'))).toEqual([
      makeEntry('a', 'Alice'),
    ])
  })

  it('does not mutate the input list', () => {
    const friends = [makeEntry('a', 'Alice')]
    withFriendInsertedAlphabetically(friends, makeEntry('b', 'Bob'))
    expect(friends).toHaveLength(1)
  })
})
