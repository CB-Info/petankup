import { describe, expect, it } from 'vitest'
import { shouldReloadProfile } from '../../app/utils/profile-load'

const PROFILE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
const PROFILE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002'
const VIEWER_X = '11111111-1111-4111-8111-111111111111'
const VIEWER_Y = '22222222-2222-4222-8222-222222222222'

describe('shouldReloadProfile', () => {
  it('ne charge jamais sans identité résolue (convergence à froid)', () => {
    expect(shouldReloadProfile([PROFILE_A, null, 'viewer'])).toBe(false)
    expect(
      shouldReloadProfile([PROFILE_A, null, 'viewer'], [PROFILE_A, null, 'viewer']),
    ).toBe(false)
  })

  it('charge au premier déclenchement quand l’identité est déjà résolue (navigation interne)', () => {
    expect(shouldReloadProfile([PROFILE_A, VIEWER_X, 'viewer'])).toBe(true)
  })

  it('charge quand l’identité se résout après le montage (le cas du bug F5)', () => {
    expect(
      shouldReloadProfile([PROFILE_A, VIEWER_X, 'viewer'], [PROFILE_A, null, 'viewer']),
    ).toBe(true)
  })

  it('ne recharge pas quand rien n’a changé (pas de double requête)', () => {
    expect(
      shouldReloadProfile([PROFILE_A, VIEWER_X, 'viewer'], [PROFILE_A, VIEWER_X, 'viewer']),
    ).toBe(false)
  })

  it('recharge au changement de profil consulté', () => {
    expect(
      shouldReloadProfile([PROFILE_B, VIEWER_X, 'viewer'], [PROFILE_A, VIEWER_X, 'viewer']),
    ).toBe(true)
  })

  it('recharge au changement d’identité du viewer (switch de compte)', () => {
    expect(
      shouldReloadProfile([PROFILE_A, VIEWER_Y, 'viewer'], [PROFILE_A, VIEWER_X, 'viewer']),
    ).toBe(true)
  })

  it('recharge à l’entrée et à la sortie de l’aperçu extérieur (changement de point de vue)', () => {
    expect(
      shouldReloadProfile([PROFILE_A, VIEWER_X, 'stranger'], [PROFILE_A, VIEWER_X, 'viewer']),
    ).toBe(true)
    expect(
      shouldReloadProfile([PROFILE_A, VIEWER_X, 'viewer'], [PROFILE_A, VIEWER_X, 'stranger']),
    ).toBe(true)
  })

  it('ne recharge pas quand le point de vue est le même (aperçu stable)', () => {
    expect(
      shouldReloadProfile(
        [PROFILE_A, VIEWER_X, 'stranger'],
        [PROFILE_A, VIEWER_X, 'stranger'],
      ),
    ).toBe(false)
  })

  it('accepte le couple (id consulté, viewer) sans point de vue — la page d’un match libre réutilise le prédicat', () => {
    expect(shouldReloadProfile([PROFILE_A, VIEWER_X], [PROFILE_A, VIEWER_X])).toBe(false)
    expect(shouldReloadProfile([PROFILE_B, VIEWER_X], [PROFILE_A, VIEWER_X])).toBe(true)
    expect(shouldReloadProfile([PROFILE_A, VIEWER_X], [PROFILE_A, null])).toBe(true)
  })

  it('tolère le premier déclenchement multi-sources de Vue (previous = [])', () => {
    // Vue passe un tableau vide, pas undefined, au premier déclenchement
    // d’un watcher multi-sources : tout est « différent », on charge.
    expect(shouldReloadProfile([PROFILE_A, VIEWER_X, 'viewer'], [] as never)).toBe(true)
  })
})
