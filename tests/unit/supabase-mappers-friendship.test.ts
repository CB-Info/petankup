import { describe, expect, it } from 'vitest'
import {
  mapFriendshipEntryJsonToDomain,
  mapFriendshipsJsonToDomain,
} from '../../app/repositories/supabase-mappers'
import type { RawFriendshipsJson } from '../../app/repositories/supabase-mappers'

// Mappers du bundle get_friendships (A3) : traduction snake→camel pure,
// SANS retri — l'ordre est garanti par la RPC (amis alpha, demandes
// récentes d'abord), le mapper doit le préserver tel quel.

describe('mapFriendshipEntryJsonToDomain', () => {
  it('translates snake_case to camelCase', () => {
    expect(
      mapFriendshipEntryJsonToDomain({ user_id: 'u1', display_name: 'Alice' }),
    ).toEqual({ userId: 'u1', displayName: 'Alice' })
  })
})

describe('mapFriendshipsJsonToDomain', () => {
  it('maps the three lists and keeps their input order untouched', () => {
    const raw: RawFriendshipsJson = {
      friends: [
        { user_id: 'u2', display_name: 'zoé' },
        { user_id: 'u1', display_name: 'Alice' },
      ],
      received: [
        { user_id: 'u3', display_name: 'Paul' },
      ],
      sent: [
        { user_id: 'u4', display_name: 'Jeanne' },
        { user_id: 'u5', display_name: 'Bob' },
      ],
    }

    const bundle = mapFriendshipsJsonToDomain(raw)

    // Ordre d'entrée préservé, même « faux » alphabétiquement : le mapper
    // ne juge pas, la RPC est le seul juge du tri.
    expect(bundle.friends.map(entry => entry.displayName)).toEqual(['zoé', 'Alice'])
    expect(bundle.received.map(entry => entry.userId)).toEqual(['u3'])
    expect(bundle.sent.map(entry => entry.userId)).toEqual(['u4', 'u5'])
  })

  it('maps empty lists to empty lists', () => {
    const bundle = mapFriendshipsJsonToDomain({ friends: [], received: [], sent: [] })
    expect(bundle).toEqual({ friends: [], received: [], sent: [] })
  })
})
