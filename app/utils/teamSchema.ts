import { z } from 'zod'

// Schema de validation pour le formulaire d'ajout/édition d'équipe.
// Chaque joueur est soit lié à un compte (userId non-null, displayName =
// snapshot du pseudo), soit libre (userId null, displayName saisi). Le
// composant filtre les slots vides AVANT de soumettre, donc le schéma valide
// la liste finale (1 à 3 joueurs non vides).
const playerInputSchema = z.object({
  userId: z.string().uuid().nullable(),
  displayName: z.string().trim().min(1).max(50),
})

export const teamSchema = z.object({
  name: z
    .string()
    .min(2, "Le nom de l'équipe doit contenir au moins 2 caractères")
    .max(50, 'Le nom ne peut pas dépasser 50 caractères'),
  players: z
    .array(playerInputSchema)
    .min(1, 'Au moins un joueur est requis')
    .max(3, 'Maximum 3 joueurs par équipe')
    // Un même invité (userId non-null) ne peut pas occuper deux slots. Les
    // joueurs libres (userId null) homonymes restent autorisés.
    .refine(
      (players) => {
        const linkedUserIds = players
          .map(player => player.userId)
          .filter((userId): userId is string => userId !== null)
        return linkedUserIds.length === new Set(linkedUserIds).size
      },
      { message: 'Un même invité ne peut pas être dans deux slots' },
    ),
})

export type TeamFormState = z.infer<typeof teamSchema>
