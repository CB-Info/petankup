import { z } from 'zod'

// Schema de validation pour le formulaire d'édition du pseudo
// (display_name). Aligné sur la CHECK constraint DB :
// char_length(trim(display_name)) between 1 and 50.
//
// .trim() normalise AVANT min/max : un pseudo composé uniquement
// d'espaces est rejeté (trim → '' → min(1) échoue), cohérent avec la
// CHECK DB qui mesure char_length(trim(...)).
export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Le pseudo est requis')
    .max(50, 'Le pseudo ne peut pas dépasser 50 caractères'),
})

export type ProfileFormState = z.infer<typeof profileSchema>
