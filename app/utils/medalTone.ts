import type { BouleTone } from '../components/BouleAvatar.vue'

// Règle rang → couleur de boule du classement (Direction C). La règle vit ici,
// jamais dans un composant : les SFC appellent cette util, ils ne la dupliquent
// pas. (Ne pas confondre avec la couleur du numéro de rang, qui suit une règle
// distincte propre à LigneClassement.)
export function medalTone(rank: number): BouleTone {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'horizon' // 4e et au-delà : bleu-acier par défaut
}
