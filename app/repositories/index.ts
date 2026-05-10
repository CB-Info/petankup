import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { SupabaseRepository } from './SupabaseRepository'
import type { TournamentRepository } from './TournamentRepository'

export type { TournamentRepository }

// Point d'entrée unique pour obtenir un repository. Le client Supabase
// typé est injecté par l'appelant (typiquement le store via
// useSupabaseClient<Database>()) — pas d'appel à un composable Nuxt
// ici, pour que la factory reste pure et facile à tester.
export function createRepository(
  client: SupabaseClient<Database>,
): TournamentRepository {
  return new SupabaseRepository(client)
}
