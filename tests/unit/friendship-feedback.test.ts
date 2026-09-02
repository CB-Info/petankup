import { describe, expect, it } from 'vitest'
import { QUIET_CONFIRMATION_TOAST } from '../../app/composables/useFriendshipFeedback'

// Le contrat de la confirmation discrète — partagée entre le succès d'un
// retrait d'ami et une suppression dont l'objectif était déjà atteint.
// Verrouille les exigences du ticket : le libellé constate sans féliciter,
// le ton visuel n'est ni une alerte ni une célébration.

describe('QUIET_CONFIRMATION_TOAST', () => {
  it('states the exact title, and nothing else — no description', () => {
    expect(QUIET_CONFIRMATION_TOAST.title).toBe("C'est fait.")
    expect('description' in QUIET_CONFIRMATION_TOAST).toBe(false)
  })

  it('keeps the neutral tone: neither the warning look nor the success green', () => {
    expect(QUIET_CONFIRMATION_TOAST.color).toBe('neutral')
    expect(QUIET_CONFIRMATION_TOAST.icon).toBe('i-lucide-check')
  })
})
