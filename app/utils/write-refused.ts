import type { WriteRefusedErrorCode } from '../types'

// Retour utilisateur d'une écriture refusée sur zéro ligne
// (WriteRefusedError) : titre et message en français, jamais le code brut.
// Le message ne dit pas POURQUOI — l'application ne le sait pas (règle
// d'accès ? ligne disparue ?) ; c'est le rechargement qui suit, fait par
// l'écran, qui montre la réalité. Pur, exhaustif (le switch sans default
// fait signaler par TypeScript tout code ajouté à WriteRefusedErrorCode).

export type WriteRefusedFeedback = {
  title: string
  description: string
}

export function writeRefusedFeedback(code: WriteRefusedErrorCode): WriteRefusedFeedback {
  switch (code) {
    case 'update_refused':
      return {
        title: 'Modification refusée',
        description: 'Cet élément a été modifié ou supprimé entre-temps.',
      }
    case 'nothing_deleted':
      return {
        title: 'Rien n\'a été supprimé',
        description: 'Cet élément a été modifié ou supprimé entre-temps.',
      }
  }
}
