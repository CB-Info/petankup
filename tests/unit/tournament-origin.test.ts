import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTournamentOrigin } from '../../app/composables/useTournamentOrigin'

const TOURNAMENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
const TOURNAMENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002'
const PROFILE_PATH = '/profile/11111111-1111-4111-8111-111111111111'

describe('useTournamentOrigin', () => {
  const { rememberProfileOrigin, readProfileOrigin, clearOrigin } =
    useTournamentOrigin()

  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restitue le chemin de profil mémorisé pour le tournoi', () => {
    rememberProfileOrigin(TOURNAMENT_A, PROFILE_PATH)
    expect(readProfileOrigin(TOURNAMENT_A)).toBe(PROFILE_PATH)
  })

  it('retourne null quand aucune origine n’a été mémorisée (repli Accueil)', () => {
    expect(readProfileOrigin(TOURNAMENT_A)).toBeNull()
  })

  it('ne confond pas les tournois : l’origine de A ne répond pas pour B', () => {
    rememberProfileOrigin(TOURNAMENT_A, PROFILE_PATH)
    expect(readProfileOrigin(TOURNAMENT_B)).toBeNull()
  })

  it('rejette toute valeur stockée qui n’est pas une route interne de profil', () => {
    const invalidStoredValues = [
      'https://evil.example/profile/x',
      'garbage',
      '/tournaments/123',
      '/profile/',
      '/profile/abc/../../admin',
      '//evil.example',
    ]
    for (const invalidValue of invalidStoredValues) {
      sessionStorage.setItem(
        `petankup:tournament-origin:${TOURNAMENT_A}`,
        invalidValue,
      )
      expect(readProfileOrigin(TOURNAMENT_A)).toBeNull()
    }
  })

  it('clearOrigin consomme l’entrée', () => {
    rememberProfileOrigin(TOURNAMENT_A, PROFILE_PATH)
    clearOrigin(TOURNAMENT_A)
    expect(readProfileOrigin(TOURNAMENT_A)).toBeNull()
  })

  it('échoue en silence quand le stockage lève (navigation privée)', () => {
    // stubGlobal (et non un spy sur Storage.prototype : sous happy-dom les
    // méthodes de sessionStorage n'en héritent pas et le spy est inopérant).
    vi.stubGlobal('sessionStorage', {
      setItem() {
        throw new Error('QuotaExceededError')
      },
      getItem() {
        throw new Error('SecurityError')
      },
      removeItem() {
        throw new Error('SecurityError')
      },
    })

    expect(() => rememberProfileOrigin(TOURNAMENT_A, PROFILE_PATH)).not.toThrow()
    expect(readProfileOrigin(TOURNAMENT_A)).toBeNull()
    expect(() => clearOrigin(TOURNAMENT_A)).not.toThrow()
  })
})
