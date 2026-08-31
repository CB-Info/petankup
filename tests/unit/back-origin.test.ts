import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  pathBelongsToContext,
  useBackOrigin,
} from '../../app/composables/useBackOrigin'

const TOURNAMENT_BASE = '/tournaments/aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
const OTHER_TOURNAMENT_BASE = '/tournaments/bbbbbbbb-bbbb-4bbb-8bbb-000000000002'
const SHARED_ENTITY_ID = 'cccccccc-cccc-4ccc-8ccc-000000000003'
const FREE_MATCH_BASE = `/free-matches/${SHARED_ENTITY_ID}`
const PROFILE_PATH = '/profile/11111111-1111-4111-8111-111111111111'
const PROFILE_ORIGIN = { label: 'Profil', to: PROFILE_PATH }

describe('useBackOrigin', () => {
  const { rememberOrigin, readOrigin, clearOrigin } = useBackOrigin()

  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restitue l’origine mémorisée pour le contexte, labellisée par le registre', () => {
    rememberOrigin(TOURNAMENT_BASE, PROFILE_PATH)
    expect(readOrigin(TOURNAMENT_BASE)).toEqual(PROFILE_ORIGIN)
  })

  it('retourne null quand aucune origine n’a été mémorisée (repli Accueil)', () => {
    expect(readOrigin(TOURNAMENT_BASE)).toBeNull()
  })

  it('ne confond pas les contextes : l’origine de A ne répond pas pour B', () => {
    rememberOrigin(TOURNAMENT_BASE, PROFILE_PATH)
    expect(readOrigin(OTHER_TOURNAMENT_BASE)).toBeNull()
  })

  it('mémorise et lit une origine pour un contexte de match libre', () => {
    rememberOrigin(FREE_MATCH_BASE, PROFILE_PATH)
    expect(readOrigin(FREE_MATCH_BASE)).toEqual(PROFILE_ORIGIN)
  })

  it('isole tournoi et match libre même pour un id d’entité identique', () => {
    rememberOrigin(`/tournaments/${SHARED_ENTITY_ID}`, PROFILE_PATH)
    expect(readOrigin(`/free-matches/${SHARED_ENTITY_ID}`)).toBeNull()
  })

  it('épingle la forme de la clé de stockage (préfixe + chemin de base)', () => {
    rememberOrigin(TOURNAMENT_BASE, PROFILE_PATH)
    expect(
      sessionStorage.getItem(`petankup:back-origin:${TOURNAMENT_BASE}`),
    ).toBe(PROFILE_PATH)
  })

  it('rejette toute valeur stockée qui n’est pas une origine du registre', () => {
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
        `petankup:back-origin:${TOURNAMENT_BASE}`,
        invalidValue,
      )
      expect(readOrigin(TOURNAMENT_BASE)).toBeNull()
    }
  })

  it('rejette une base de contexte stockée comme origine (ensembles disjoints)', () => {
    sessionStorage.setItem(
      `petankup:back-origin:${FREE_MATCH_BASE}`,
      '/free-matches/dddddddd-dddd-4ddd-8ddd-000000000004',
    )
    expect(readOrigin(FREE_MATCH_BASE)).toBeNull()
  })

  it('clearOrigin consomme l’entrée', () => {
    rememberOrigin(TOURNAMENT_BASE, PROFILE_PATH)
    clearOrigin(TOURNAMENT_BASE)
    expect(readOrigin(TOURNAMENT_BASE)).toBeNull()
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

    expect(() => rememberOrigin(TOURNAMENT_BASE, PROFILE_PATH)).not.toThrow()
    expect(readOrigin(TOURNAMENT_BASE)).toBeNull()
    expect(() => clearOrigin(TOURNAMENT_BASE)).not.toThrow()
  })
})

describe('pathBelongsToContext', () => {
  it('reconnaît la page du contexte elle-même', () => {
    expect(pathBelongsToContext(TOURNAMENT_BASE, TOURNAMENT_BASE)).toBe(true)
  })

  it('reconnaît une sous-page du contexte (résultats)', () => {
    expect(
      pathBelongsToContext(`${TOURNAMENT_BASE}/results`, TOURNAMENT_BASE),
    ).toBe(true)
  })

  it('rejette un autre contexte', () => {
    expect(pathBelongsToContext(OTHER_TOURNAMENT_BASE, TOURNAMENT_BASE)).toBe(false)
  })

  it('rejette un faux préfixe (base prolongée)', () => {
    expect(
      pathBelongsToContext(`${TOURNAMENT_BASE}x/results`, TOURNAMENT_BASE),
    ).toBe(false)
  })

  it('rejette les routes hors contexte', () => {
    expect(pathBelongsToContext('/', TOURNAMENT_BASE)).toBe(false)
    expect(pathBelongsToContext(PROFILE_PATH, TOURNAMENT_BASE)).toBe(false)
  })

  it('fonctionne pour une base de match libre ; /free-matches/new reste hors contexte', () => {
    expect(pathBelongsToContext(FREE_MATCH_BASE, FREE_MATCH_BASE)).toBe(true)
    expect(pathBelongsToContext(`${FREE_MATCH_BASE}/partage`, FREE_MATCH_BASE)).toBe(true)
    expect(pathBelongsToContext('/free-matches/new', FREE_MATCH_BASE)).toBe(false)
  })
})
