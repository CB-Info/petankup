import { z } from 'zod'

// Schema de validation pour le formulaire de création/édition de tournoi.
// Les champs optionnels (location, description) acceptent aussi la chaîne
// vide : c'est ce que renvoie un input HTML laissé vide, et on ne veut
// pas que ça déclenche une erreur de validation.
export const tournamentSchema = z.object({
  name: z
    .string()
    .min(2, 'Le nom doit contenir au moins 2 caractères')
    .max(100, 'Le nom ne peut pas dépasser 100 caractères'),
  date: z.string().min(1, 'La date est requise'),
  location: z
    .string()
    .max(100, 'Le lieu ne peut pas dépasser 100 caractères')
    .optional()
    .or(z.literal('')),
  description: z
    .string()
    .max(500, 'La description ne peut pas dépasser 500 caractères')
    .optional()
    .or(z.literal('')),
  visibility: z.enum(['private', 'public']).default('private'),
  // Une seule valeur aujourd'hui (round-robin only, cf. CLAUDE.md) — le
  // champ est typé pour la carte de sélection Format, sans sur-construire
  // pour des formats qui n'existent pas encore.
  format: z.enum(['round_robin']).default('round_robin'),
})

export type TournamentFormState = z.infer<typeof tournamentSchema>
