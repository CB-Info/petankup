import { z } from 'zod'

// Schema de validation pour le formulaire d'ajout/édition d'équipe.
// Le composant filtre les noms de joueurs vides AVANT de soumettre,
// donc le schéma valide la liste finale (1 à 3 joueurs non vides).
export const teamSchema = z.object({
  name: z
    .string()
    .min(2, "Le nom de l'équipe doit contenir au moins 2 caractères")
    .max(50, 'Le nom ne peut pas dépasser 50 caractères'),
  players: z
    .array(z.string().min(1).max(50))
    .min(1, 'Au moins un joueur est requis')
    .max(3, 'Maximum 3 joueurs par équipe'),
})

export type TeamFormState = z.infer<typeof teamSchema>
