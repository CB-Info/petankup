import { describe, expect, it } from 'vitest'
import {
  assertNoUnconfiguredRepositoryCalls,
  createRepositoryDouble,
} from '../helpers/repository-double'

// Tests de la fabrique des faux dépôts : la règle « une méthode non
// configurée échoue bruyamment », y compris quand l'appelant avale l'erreur.
// Chaque test vide lui-même le registre via assertNoUnconfiguredRepositoryCalls,
// de sorte que la vérification armée par la fabrique reste verte.

describe('createRepositoryDouble', () => {
  it('rejects an unconfigured method, naming it, and reports it afterwards', async () => {
    const double = createRepositoryDouble()

    await expect(double.getAllTournaments()).rejects.toThrow(
      'Repository method "getAllTournaments" was called but this test did not configure it',
    )
    expect(() => assertNoUnconfiguredRepositoryCalls()).toThrow(
      'Unconfigured repository methods were called: getAllTournaments',
    )
    // Le registre est vidé par la vérification : rien à signaler ensuite.
    expect(() => assertNoUnconfiguredRepositoryCalls()).not.toThrow()
  })

  it('answers through a configured method without any report', async () => {
    const double = createRepositoryDouble({ getAllTournaments: async () => [] })

    expect(await double.getAllTournaments()).toEqual([])
    expect(() => assertNoUnconfiguredRepositoryCalls()).not.toThrow()
  })

  it('reports a call whose error was swallowed by the caller', async () => {
    const double = createRepositoryDouble()

    await double.getMyProfile().catch(() => undefined)

    expect(() => assertNoUnconfiguredRepositoryCalls()).toThrow(
      'Unconfigured repository methods were called: getMyProfile',
    )
  })

  it('leaves a method unconfigured when its entry is undefined', async () => {
    const double = createRepositoryDouble({ getFriendships: undefined })

    await expect(double.getFriendships()).rejects.toThrow(
      'Repository method "getFriendships" was called but this test did not configure it',
    )
    expect(() => assertNoUnconfiguredRepositoryCalls()).toThrow('getFriendships')
  })
})
