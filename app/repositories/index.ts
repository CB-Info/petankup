import { LocalStorageRepository } from './LocalStorageRepository'
import type { TournamentRepository } from './TournamentRepository'

export type { TournamentRepository }

// Point d'entrée unique pour obtenir un repository.
// En V2 (Supabase), seule cette fonction change : le reste du code
// (stores, composables, composants) continue d'utiliser le contrat
// `TournamentRepository` sans rien savoir de l'implémentation.
export function createRepository(): TournamentRepository {
  return new LocalStorageRepository()
}
