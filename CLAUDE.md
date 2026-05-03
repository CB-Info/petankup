# Pétanque Tournament Manager

Application web privée mobile-first pour gérer des tournois de pétanque
entre amis. MVP local-only, pas de backend en V1.

## Stack

- Nuxt 4 en mode SPA (`ssr: false`)
- Vue 3 + TypeScript strict
- **Nuxt UI v4** (lib de composants) — Tailwind CSS v4 + Reka UI sous le capot
- Pinia (state)
- Vitest (tests unitaires)
- localStorage (persistance V1)
- Vercel (déploiement cible)

## UI — Nuxt UI v4

- **Toujours utiliser les composants Nuxt UI** (`UButton`, `UInput`, `UCard`,
  `UModal`, `UTable`, `UForm`, etc.) plutôt que de recoder en HTML+Tailwind.
- Si un composant Nuxt UI n'existe pas pour le besoin → composant maison
  dans `/components`, en réutilisant les classes Tailwind cohérentes.
- Accessibilité (ARIA, focus, clavier) gérée automatiquement par Nuxt UI.
  Ne pas réimplémenter à la main sauf cas spécifique.
- `<UApp>` wrap la racine dans `app.vue` (requis pour toasts, modals
  programmatiques).
- Theming : utiliser `app.config.ts` pour personnaliser couleurs et tokens,
  pas de surcharge CSS sauvage.
- Doc : https://ui.nuxt.com

## Commandes

- `npm run dev` — serveur de développement
- `npm run build` — build production
- `npm run test` — tests Vitest
- `npm run typecheck` — vérification TypeScript

## Décisions d'architecture (ne pas remettre en cause sans demander)

1. **SPA only** — `ssr: false` dans `nuxt.config.ts`. Pas de SSR, pas de SSG.
2. **Pattern Repository** — les stores Pinia n'accèdent JAMAIS directement à
   `localStorage`. Tout passe par une interface `TournamentRepository`.
   `LocalStorageRepository` en V1, `SupabaseRepository` viendra en V2.
3. **Format de tournoi : round-robin uniquement** — l'élimination directe
   est V2, ne pas l'implémenter.
4. **IDs : UUID v4 client** via `crypto.randomUUID()`. Pas d'auto-increment.
5. **Dates : strings ISO** dans tous les types et la persistance. Jamais
   d'objet `Date` stocké.
6. **`ownerId: string | null` sur `Tournament`** — `null` en V1, prépare
   l'auth Supabase V2.

## Domaine métier

### Validation des scores (pétanque)

- Les deux scores sont des entiers ≥ 0
- `max(scoreA, scoreB) >= 13`
- `scoreA !== scoreB` (pas de match nul à la pétanque)

### Équipe

- 1 à 3 joueurs : `players: string[]`
- UI : doublette par défaut

### Classement (ordre de tri pour départage)

1. Victoires (desc)
2. Différence de points (desc)
3. Points marqués (desc)
4. Résultat direct si applicable

## Structure du projet

- `/pages` — pages Nuxt (file-based routing)
- `/components` — composants Vue réutilisables
- `/composables` — composables Vue
- `/stores` — stores Pinia
- `/repositories` — interface + implémentations de persistance
- `/types` — types TS du domaine
- `/utils` — fonctions pures (logique métier)
- `/tests/unit` — tests Vitest

## Conventions de code

- TypeScript strict, `any` interdit sauf justification en commentaire
- Composition API exclusivement (`<script setup lang="ts">`)
- Composants en PascalCase, composables préfixés `use`
- Pas de logique métier dans les composants → composable ou util
- Fonctions de `/utils` strictement pures : pas de side effect, pas de
  `Date.now()` interne (timestamps injectés en paramètre)
- Pas de CSS custom quand Tailwind suffit

## À NE JAMAIS faire

- ❌ Toucher `localStorage` ailleurs que dans `/repositories`
- ❌ Ajouter une AUTRE lib UI ou design system par-dessus Nuxt UI (PrimeVue,
  Vuetify, shadcn-vue, etc.) — Nuxt UI est notre référence unique
- ❌ Ajouter Supabase ou une dépendance backend sans validation explicite
- ❌ Recoder à la main un composant qui existe déjà dans Nuxt UI
- ❌ Créer un autre format de tournoi que round-robin
- ❌ Stocker un objet `Date` au lieu d'une string ISO
- ❌ Utiliser un ID auto-increment
- ❌ Mettre de la logique métier dans un composant Vue
- ❌ Skipper les tests Vitest pour les fonctions de `/utils`

## Workflow

- Un ticket = un focus
- `npm run build` ET `npm run test` doivent passer avant tout commit
- En cas de doute sur le scope ou une décision : demander avant de coder

## Hors scope MVP (refuser proactivement si suggéré)

- Comptes utilisateurs, authentification
- Lien public / partage distant
- Statistiques cross-tournois
- Export PDF
- Notifications
- Multi-format (élimination directe, etc.)
