import { z } from 'zod'

// Un id de route qui n'a pas la forme d'un UUID ne peut désigner aucune
// ressource : c'est détectable sans requête, et la base répondrait par une
// erreur de cast (22P02) présentée à tort comme une panne. Zod (déjà
// dépendance du projet) plutôt qu'une regex maison. Postgres accepte la
// casse mixte — ce validateur aussi.
const uuidSchema = z.string().uuid()

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success
}
