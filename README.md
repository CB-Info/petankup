# Pétankup — Pétanque Tournament Manager

Application web privée mobile-first pour gérer des tournois de pétanque entre
amis. Persistance Supabase, auth magic link + Google OAuth.

## Stack

- [Nuxt 4](https://nuxt.com) en mode SPA (`ssr: false`)
- Vue 3 + TypeScript strict
- [Nuxt UI v4](https://ui.nuxt.com) (Tailwind CSS v4 + Reka UI)
- [Pinia](https://pinia.vuejs.org) — state management
- [Vitest](https://vitest.dev) + happy-dom — tests unitaires
- [Supabase](https://supabase.com) — Postgres + auth (magic link + Google OAuth)
- [Zod](https://zod.dev) — validation formulaires (intégrée à UForm)
- Vercel — déploiement cible

## Commandes

```bash
npm install        # installer les dépendances
npm run dev        # serveur de dev sur http://localhost:3000
npm run build      # build de production
npm run preview    # prévisualiser le build
npm run test       # lancer Vitest
npm run typecheck  # vérification TypeScript stricte
npm run gen:types  # régénère app/types/database.types.ts depuis le schéma Supabase
```

## Variables d'environnement

Copier `.env.example` en `.env` et renseigner les variables Supabase :

- `NUXT_PUBLIC_SUPABASE_URL`
- `NUXT_PUBLIC_SUPABASE_KEY`

Voir `CLAUDE.md` (section Variables d'environnement) pour les détails.

## Structure

Le code applicatif vit dans `app/` (convention Nuxt 4) :

- `app/pages` — pages (file-based routing)
- `app/layouts` — layouts Nuxt
- `app/components` — composants Vue
- `app/composables` — composables Vue
- `app/stores` — stores Pinia
- `app/repositories` — interface + impls de persistance
- `app/types` — types TS du domaine
- `app/utils` — fonctions pures (logique métier)
- `app/assets/css` — Tailwind + Nuxt UI

Et à la racine : `tests/unit` (Vitest), `supabase/migrations` (DDL versionnés),
`nuxt.config.ts`, `vitest.config.ts`, `CLAUDE.md`.

Voir `CLAUDE.md` pour les conventions et décisions d'architecture.
