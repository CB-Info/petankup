# Pétanque Tournament Manager

Application web privée mobile-first pour gérer des tournois de pétanque
entre amis. Persistance Supabase, auth magic link et Google OAuth.

Pour la vision produit, le périmètre fonctionnel et les règles métier,
voir `references/cahier_des_charges.md`. Le présent CLAUDE.md reste la
référence technique opérationnelle.

## Stack

- Nuxt 4 en mode SPA (`ssr: false`)
- Vue 3 + TypeScript strict
- **Nuxt UI v4** (lib de composants) — Tailwind CSS v4 + Reka UI sous le capot
- Pinia (state)
- Vitest (tests unitaires)
- Supabase (Postgres + auth magic link, persistance active)
- Zod (validation formulaires, intégré avec UForm)
- Vercel (déploiement cible)

## Authentification

Providers actifs :

- Magic link email (via Resend, en attente de vérification de
  domaine — actuellement limité à l'adresse personnelle vérifiée)
- Google OAuth (mode Testing, max 100 test users, suffisant pour
  le projet)

Pages :

- `/login` : formulaire email + bouton Google
- `/confirm` : callback commun aux deux providers (PKCE)

Secrets :

- Client Secret Google : uniquement dans Supabase Dashboard.
  Jamais dans le code, `.env`, `NUXT_PUBLIC_*`, ni dans un prompt.
- `service_role` key Supabase : non utilisée dans ce projet. Ne
  JAMAIS l'introduire côté frontend ni côté repo.
- Seules `NUXT_PUBLIC_SUPABASE_URL` et `NUXT_PUBLIC_SUPABASE_KEY`
  (clé anon/publishable) vivent dans le frontend.

Manual linking : volontairement DÉSACTIVÉ côté Supabase. Si un
user se connecte avec le même email via magic link puis Google,
le comportement attendu est que Supabase associe automatiquement
les identités lorsque les conditions d'email vérifié sont réunies.
Ce comportement doit être vérifié manuellement dans Supabase
Dashboard. Ne pas activer `enableManualLinking` pour l'instant.

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

### Audit Nuxt UI avant de coder un composant

- Avant de proposer ou de coder un nouveau composant maison, **audit
  obligatoire** des composants Nuxt UI v4 existants (`UAvatar`, `UUser`,
  `UCard`, `UEmpty`, `UBadge`, etc.).
- Ne recoder à la main que si le composant Nuxt UI n'existe vraiment pas
  ou ne couvre vraiment pas le besoin.
- Documenter ce que Nuxt UI fait déjà (initiales auto sur `UAvatar`
  quand `alt` est fourni, etc.) plutôt que de réimplémenter.

## Charte graphique

### Identité visuelle

Ambiance décontractée et conviviale. Tons chauds, coins arrondis,
espacement généreux. L'app doit évoquer un après-midi de pétanque
entre amis, pas un dashboard corporate.

### Couleurs — Light mode

Primaire (bleu horizon) :

- 50: #E8F2F5 — fond léger, hover subtil
- 100: #C4DEE5 — tags, badges
- 200: #9DC8D3 — bordures accent
- 400: #7BAAB9 — couleur de référence
- 500: #5A8A98 — boutons principaux, liens
- 600: #3D6E7C — hover boutons
- 800: #2B5060 — texte sur fond primaire clair
- 900: #1A3540 — texte fort

Secondaire (sable doré) :

- 50: #F5F2E4 — fond alternatif, tags doux
- 100: #EDE7C8 — séparateurs, accents légers
- 200: #E3DAAB — bordures secondaires
- 400: #D9CC92 — couleur de référence
- 500: #C2B574 — boutons secondaires
- 600: #A89C5A — hover secondaire
- 800: #7A7240 — texte sur fond secondaire
- 900: #4A4425 — texte fort secondaire

Neutres :

- bg: #FAFAF6 — fond de page
- surface: #F2F0EB — cartes, zones surélevées
- border: #E5E2DB — bordures par défaut
- muted: #8A8880 — texte désactivé, placeholders
- subtle: #5C5A54 — texte secondaire
- text: #2C2A25 — texte principal

Sémantiques :

- success: bg #DCEEE2, text #2B6B3E
- warning: bg #FFF3D6, text #8A6B1A
- danger: bg #FCE8E8, text #A03030
- info: bg #E6F0FA, text #2B5F8A

### Couleurs — Dark mode

Primaire (brun fumé) :

- 50: #2D2320 — fond léger dark
- 100: #3D322C
- 200: #4E3F38
- 400: #634C44 — couleur de référence
- 500: #7E6258 — boutons principaux dark
- 600: #9A7E72
- 800: #C4A898
- 900: #E0CFC5

Secondaire (parchemin) :

- 50: #2E2A20
- 100: #4A4230
- 200: #6B6040
- 400: #A09570
- 500: #C9B990
- 600: #DDD0A8
- 800: #EBE0C0
- 900: #F0E3C3 — couleur de référence

Neutres dark :

- bg: #1E1916
- surface: #2A2420
- border: #3D3530
- muted: #7A7068
- subtle: #B0A498
- text: #F0E3C3

### Application des couleurs (règles)

- **Bouton principal** : bg primaire-500, hover primaire-600, texte blanc
- **Bouton secondaire** : bg secondaire-400, hover secondaire-500,
  texte secondaire-900
- **Cards** : bg surface, border border, radius arrondi (rounded-xl)
- **Tags statut** : En cours → primaire-100/primaire-800,
  Draft → secondaire-50/secondaire-800,
  Terminé → success bg/text
- **Classement positions** : 1er → primaire-500, 2e → primaire-400,
  3e → secondaire-500, reste → muted
- **Inputs** : bg surface, border border, focus ring primaire-400
- **Fond de page** : bg (jamais blanc pur #fff)
- **Texte principal** : text (jamais noir pur #000)

### Conventions de nommage couleurs dans les templates

**Rampes primaire/secondaire** : ne jamais utiliser les noms internes
`horizon-*` ou `sand-*` dans les fichiers `.vue`. Toujours utiliser
les alias sémantiques `primary-*` et `secondary-*`. Les rampes
`horizon` et `sand` ne sont que des implémentations dans `main.css`
et `app.config.ts` — le code applicatif ne les connaît pas.

**Neutres** : ne pas créer de variables CSS custom pour les neutres.
Utiliser les classes sémantiques Nuxt UI, qui sont overridées dans
`main.css` pour coller à la charte :

| Besoin                  | Classe Nuxt UI   | Valeur light |
| ----------------------- | ---------------- | ------------ |
| Fond de page            | `bg-default`     | #FAFAF6      |
| Surface (cards, header) | `bg-elevated`    | #F2F0EB      |
| Bordure par défaut      | `border-default` | #E5E2DB      |
| Texte principal         | `text-default`   | #2C2A25      |
| Texte secondaire        | `text-toned`     | #5C5A54      |
| Texte désactivé         | `text-muted`     | #8A8880      |

Ces classes basculent automatiquement en dark mode via les overrides
`--ui-*` dans `main.css`. Pas besoin de `dark:` manuels.

**Danger** : les couleurs danger n'ont pas d'équivalent Nuxt UI natif.
Utiliser `bg-(--petankup-danger-bg)` et `text-(--petankup-danger-text)`,
définis dans `main.css`.

### Nuxt UI — Intégration des couleurs

Les couleurs custom se configurent dans `app.config.ts` via le
système de tokens Nuxt UI. Utiliser la couleur `primary` pour le
bleu horizon et `secondary` pour le sable doré. Les neutres
passent par le thème `neutral`.

### Typographie

- Police par défaut de Nuxt UI (système)
- Pas de police custom en V1
- Titres : font-weight 600, tailles via composants Nuxt UI
- Corps : font-weight 400, text-base (16px)

### Spacing et arrondis

- Arrondis généreux : rounded-xl sur les cards, rounded-lg sur les
  boutons et inputs, rounded-full sur les avatars/positions
- Padding confortable : p-4 minimum sur les cards, p-3 sur les boutons
- Espacement vertical : space-y-4 entre les sections

### Mobile-first

- Tous les layouts en colonne unique sur mobile
- Boutons full-width sur mobile (w-full)
- Touch targets minimum 44px
- Pas de hover-only — tout doit être accessible au tap
- Texte minimum 14px, jamais en dessous

## Design system de référence

Le dossier `/references/design-system/` contient un design system
complet généré séparément (Claude Design) :

- `petankup-design/README.md` — direction artistique, tonalité,
  vocabulaire métier, fundamentals visuels
- `petankup-design/colors_and_type.css` — tokens canoniques
- `petankup-design/preview/` — previews HTML des composants
- `petankup-design/ui_kits/petankup-mobile/` — UI kit mobile
  pixel-perfect en JSX (référence pour la mise en page)

### Règles d'usage

1. **Référence uniquement, pas de copier-coller.** Le code JSX du UI
   kit ne doit JAMAIS être copié dans le code Nuxt. Il sert à voir
   l'intention visuelle, pas à fournir le code.
2. **En cas de contradiction**, `CLAUDE.md` (Charte graphique) fait
   foi sur les couleurs et tokens. Le design system fait foi sur
   la tonalité, le vocabulaire métier et la composition d'écrans.
3. **Vocabulaire métier obligatoire** : Tournoi, Équipe, Match,
   Manche, Classement, Podium, Brouillon, En cours, Terminé.
   Voir `references/design-system/petankup-design/README.md`
   section "Content fundamentals".
4. **Pas d'emoji dans l'UI produit.**
5. **Aucun fichier ne doit être créé ou modifié dans `/references/`.**
   C'est un dossier en lecture seule pour le développement.

## Variables d'environnement

Définies dans `.env` (gitignored) :

- `NUXT_PUBLIC_SUPABASE_URL` — URL du projet Supabase (ex :
  `https://xxx.supabase.co`)
- `NUXT_PUBLIC_SUPABASE_KEY` — clé publique anon du projet (legacy JWT,
  pas la nouvelle clé `sb_publishable_*`)

`.env.example` est versionné et liste les variables attendues.

Le préfixe `NUXT_PUBLIC_` est requis (convention `runtimeConfig` Nuxt).
Les variables `SUPABASE_URL` et `SUPABASE_KEY` sans préfixe sont
supportées en fallback mais à éviter.

## Migrations Supabase

- Migrations versionnées dans `supabase/migrations/`, format timestampé
  `YYYYMMDDHHMMSS_<nom>.sql`.
- Source de vérité : Git. Pas d'éditions DDL hors fichier de migration
  committed.
- Workflow :
  1. Éditer ou créer une migration dans `supabase/migrations/`
  2. Commit
  3. Appliquer avec `npx supabase db push`
  4. Régénérer les types : `npm run gen:types`

## Commandes

- `npm run dev` — serveur de développement
- `npm run build` — build production
- `npm run test` — tests Vitest
- `npm run typecheck` — vérification TypeScript
- `npm run gen:types` — régénère les types TS depuis le schéma Supabase

## Décisions d'architecture (ne pas remettre en cause sans demander)

1. **SPA only** — `ssr: false` dans `nuxt.config.ts`. Pas de SSR, pas de SSG.
2. **Pattern Repository** — les stores Pinia n'accèdent JAMAIS directement à
   la base de données. Tout passe par une interface `TournamentRepository`.
   `SupabaseRepository` est l'implémentation active.
3. **Persistance Supabase** — Postgres avec RLS appliquée sur toutes les
   tables applicatives. La visibilité d'un tournoi suit trois cas : owner,
   membre invité, ou tournoi public. Les autorisations transverses
   (équipes, matchs, joueurs d'équipe, membres) passent par des helpers
   privés `SECURITY DEFINER` dans le schéma `private`, exposés au besoin
   par des wrappers publics `SECURITY INVOKER`, avec grants explicites
   par colonne plutôt que `GRANT ALL`. Migrations versionnées dans
   `supabase/migrations/`, idempotentes (`DO/EXCEPTION`, `IF EXISTS`),
   `search_path=''` enforced.
4. **Auth magic link + Google OAuth** — magic link email (via Resend) et
   Google OAuth. La page `/confirm` est le callback PKCE commun aux deux
   providers. Pas de password, pas d'auth anonyme.
5. **Format de tournoi : round-robin uniquement** — l'élimination directe
   est V2, ne pas l'implémenter.
6. **IDs : UUID v4 client** via `crypto.randomUUID()`. Pas d'auto-increment.
7. **Dates : strings ISO** dans tous les types et la persistance. Jamais
   d'objet `Date` stocké.
8. **`ownerId: string` non-nullable sur `Tournament`** — peuplé via
   `useSupabaseUser().value.sub` dans le store, mappé vers `owner_id`
   côté DB.

### Repository : écritures explicites

- Pas d'`upsert` aveugle dans le repository : une écriture est soit une
  création, soit une mise à jour, jamais un mélange spéculatif des deux.
  (Convention généralisée après un bug réel : la phase INSERT spéculative
  d'un upsert déclenchait une CHECK constraint Postgres `23514` sur un
  tournoi terminé.)
- Pour chaque opération de persistance, deux méthodes distinctes :
  `create*` (`INSERT`) et `update*` (`UPDATE` avec `.eq('id')`).
- Mappers domain → DB séparés pour la création et pour la mise à jour
  (le mapper update n'inclut que les colonnes mutables).
- Critère de complétude : `grep -R "\.upsert(" app/repositories/` doit
  retourner vide.

## Auth

### Flow magic link

1. User saisit email sur `/login` → `signInWithOtp`
2. Mail reçu avec un lien `?code=<uuid>`
3. Clic ouvre `/confirm?code=...` (configuré dans `redirectOptions.callback`)
4. Le SDK Supabase auto-échange le code PKCE et écrit la session en
   localStorage
5. Watcher de `confirm.vue` détecte la session et redirige vers `/`

### Pièges connus du module @nuxtjs/supabase v2 (ne pas oublier)

- **`useSupabaseUser()` retourne un `JwtPayload`, pas un `User`.** Le ref
  est hydraté via `client.auth.getClaims()`, donc l'user ID est dans
  `user.value.sub`, pas `user.value.id`. Ne pas se fier au typage qui
  laisse penser le contraire.
- **`useSupabaseSession()` est mis à jour de façon fiable** par le plugin
  du module via `getSession()` au boot. À utiliser comme indicateur
  d'authentification dans les composants UI (layout, page de callback,
  page de login). Si on a besoin de l'user ID dans un composant UI, lire
  `session.value.user.id` (objet `User` standard, pas un JwtPayload).
- **`useSupabaseUser()` n'est pas hydraté immédiatement après auth via
  magic link.** Le hook `page:start` du module ne fire pas pour la
  transition initiale `/confirm` → `/`. Conséquence : utiliser
  `useSupabaseSession()` dans les composants où la condition d'auth doit
  être réactive dès le mount initial.
- **Le store reste sur `useSupabaseUser().value.sub`** car son contexte
  d'usage (pages applicatives navigées normalement où `page:start` a fire)
  garantit que le ref est hydraté à ce moment.

### Configuration `nuxt.config.ts` à ne pas casser

- `useSsrCookies: false` → impose le storage de session en localStorage
  (compatible SPA, évite les problèmes de cookie path scope).
- `clientOptions.auth.flowType: 'pkce'` → override nécessaire car avec
  `useSsrCookies: false`, le module utilise `createClient` standard de
  `@supabase/supabase-js` dont le default est `implicit`.

## Domaine métier

### Validation des scores (pétanque)

- Les deux scores sont des entiers ≥ 0
- `max(scoreA, scoreB) >= 13`
- `scoreA !== scoreB` (pas de match nul à la pétanque)

### Équipe

- 1 à 3 joueurs par équipe : `players: TeamPlayer[]`. UI : doublette
  par défaut.
- Chaque joueur d'équipe (`TeamPlayer`, cf. `app/types/index.ts`)
  distingue deux cas :
  - **Joueur lié à un compte** : `userId` non-null, avec
    `displayNameSnapshot` figé au moment de l'écriture — fallback utile
    si le pseudo change a posteriori, ou si le compte est supprimé
    (`userId` repasse alors à NULL via la cascade DB).
  - **Joueur libre** : `userId: null`, seul le nom saisi à la main est
    conservé. Concept durable du domaine (joueurs occasionnels qui ne
    veulent pas créer de compte), pas une feature de transition.
- Un joueur lié à un compte ne peut pas être dans deux équipes du même
  tournoi (verrouillé en base par un index unique partiel).

### Classement (ordre de tri pour départage)

1. Victoires (desc)
2. Différence de points (desc)
3. Points marqués (desc)
4. Résultat direct si applicable

### Visibilité et cycle de vie

- Trois statuts de tournoi : Brouillon (`draft`), En cours
  (`in_progress`), Terminé (`completed`).
- Cycle de vie strict : Brouillon → En cours (au démarrage) → Terminé
  (à la complétion). Pas de retour arrière. Un tournoi Terminé est
  **définitivement immuable** (scores, équipes, visibilité,
  suppression) — verrou DB à finaliser.
- Deux visibilités : `private` (par défaut : owner + membres invités)
  ou `public` (visible de tous les utilisateurs authentifiés).
  Modifiable tant que le tournoi n'est pas terminé.
- Les memberships (joueurs invités sur un tournoi privé) sont gérés
  par invitation par pseudo.

### Profil et pseudo

- Chaque utilisateur authentifié a un profil créé automatiquement au
  premier login.
- Le pseudo est **unique** entre utilisateurs (insensible à la casse
  et aux espaces de bord), 1 à 50 caractères après trim (CHECK côté
  DB).
- Le pseudo est modifiable à tout moment.
- Les profils sont tous publics entre utilisateurs authentifiés en V1.
  Une visibilité plus fine (système d'amis, profils détaillés pour les
  amis) viendra plus tard — hors périmètre V1.

### Statistiques pré-calculées (matérialisées)

- Les statistiques de joueur (par tournoi terminé et agrégées
  globales) sont **matérialisées** dans des tables dédiées via des
  triggers Postgres à la complétion d'un tournoi.
- Pas de requêtes live qui recalculent les stats à chaque consultation
  de profil : une seule lecture par chargement de profil.
- Les **joueurs libres sont exclus** des statistiques (pas de compte =
  pas de profil). Ils restent visibles en snapshot dans le journal de
  bord des autres joueurs.
- Le profil utilisateur est récupéré via une RPC unique qui retourne
  le bundle complet (profil + stats + journal).

### Vocabulaire métier

Termes canoniques à utiliser dans le code, l'UI, les commits et les
tickets :

- Tournoi, Équipe, Match, Manche, Classement, Podium, Vainqueur.
- Brouillon, En cours, Terminé.
- Pseudo, Profil, Journal de bord.
- Organisateur (côté UI / produit), `owner` (côté technique / DB).
- Joueur lié à un compte, Joueur libre.
- Membre invité, Tournoi privé, Tournoi public.

## Structure du projet

Le code applicatif vit dans `app/` (convention Nuxt 4) :

- `app/pages` — pages Nuxt (file-based routing)
- `app/layouts` — layouts Nuxt
- `app/components` — composants Vue réutilisables
- `app/composables` — composables Vue
- `app/stores` — stores Pinia
- `app/repositories` — interface + implémentations de persistance
- `app/types` — types TS du domaine
- `app/utils` — fonctions pures (logique métier)
- `app/assets/css` — Tailwind + Nuxt UI

À la racine : `tests/unit` (tests Vitest), `supabase/migrations`
(migrations DDL versionnées).

## Conventions de code

- TypeScript strict, `any` interdit sauf justification en commentaire
- Composition API exclusivement (`<script setup lang="ts">`)
- Composants en PascalCase, composables préfixés `use`
- Pas de logique métier dans les composants → composable ou util
- Fonctions de `/utils` strictement pures : pas de side effect, pas de
  `Date.now()` interne (timestamps injectés en paramètre)
- Pas de CSS custom quand Tailwind suffit

## Lisibilité du code (RÈGLE PRIORITAIRE)

L'utilisateur doit pouvoir lire le code une fois et se l'approprier sans
avoir à demander d'explication. Optimiser pour la compréhension humaine,
PAS pour la concision ni pour la performance d'écriture.

- **Noms explicites obligatoires.** Pas de variables d'une lettre
  (`a`, `b`, `i`, `n`, `m`), pas d'abréviations cryptiques (`opp`, `pf`,
  `idx`, `tmp`). Préférer `pointsScoredByOpponent` à `opp`,
  `roundNumber` à `r`, `pairIndex` à `i`. Tolérés : conventions
  universelles (`id`, `url`, `db`).
- **Décomposer les fonctions denses.** Une fonction = une intention. Si
  elle fait deux choses (construire un objet ET itérer, par exemple),
  extraire la sous-tâche dans un helper nommé — même si appelé une seule
  fois. Le nom du helper sert de documentation.
- **Pas d'astuce sans nom.** Une expression « élégante » mais cryptique
  comme `rest.unshift(rest.pop()!)` doit être extraite dans une fonction
  nommée (`rotateAllExceptFirst`, etc.).
- **Algorithmes non triviaux = commentaire court en tête.** Pour un
  algorithme classique (cercle round-robin, tri custom, parsing) ou un
  choix non évident, 2–4 lignes en tête de fonction expliquant l'idée
  et le pourquoi. Pas de détail ligne par ligne.
- **Types nommés pour les retours composites.** Préférer
  `type ScoreValidationResult = { valid: boolean, error?: string }` à
  un objet anonyme dans la signature.
- **Variables booléennes auto-explicatives.** Préférer
  `const teamCountIsOdd = ...` à un `if (n % 2 !== 0)` brut dans une
  condition.

## À NE JAMAIS faire

- ❌ Accéder directement à la DB Supabase (ou à `localStorage` pour des
  données métier) ailleurs que dans `/repositories`
- ❌ Ajouter une AUTRE lib UI ou design system par-dessus Nuxt UI (PrimeVue,
  Vuetify, shadcn-vue, etc.) — Nuxt UI est notre référence unique
- ❌ Ajouter Supabase ou une dépendance backend sans validation explicite
- ❌ Recoder à la main un composant qui existe déjà dans Nuxt UI
- ❌ Créer un autre format de tournoi que round-robin
- ❌ Stocker un objet `Date` au lieu d'une string ISO
- ❌ Utiliser un ID auto-increment
- ❌ Mettre de la logique métier dans un composant Vue
- ❌ Confondre `useSupabaseUser()` (JwtPayload, champ `sub`) avec
  `session.value.user` (objet User Supabase, champ `id`)
- ❌ Skipper les tests Vitest pour les fonctions de `/utils`
- ❌ Utiliser une autre lib de validation que Zod (pas Yup, pas Valibot,
  pas de validation manuelle dans UForm)
- ❌ Utiliser `horizon-*` ou `sand-*` dans un fichier `.vue` — toujours
  `primary-*` / `secondary-*`
- ❌ Créer des variables CSS custom `--app-*` ou `--petankup-*` pour les
  neutres — utiliser les classes Nuxt UI (`bg-default`, `text-toned`, etc.)
- ❌ Faire un `upsert` dans un repository — toujours `create*` / `update*`
  explicites
- ❌ Créer ou modifier un fichier dans `references/` (dossier read-only)
- ❌ Ajouter un `Co-Authored-By` dans un message de commit
- ❌ Modifier un tournoi `terminé` — invariant produit ; le verrou côté
  base est en cours de finalisation

## Conventions Git

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`,
  `refactor:`, etc.).
- Conventional Branch (`feature/...`, `fix/...`, `chore/...`,
  `docs/...`).
- Un ticket = un commit lisible et revertable.
- Pas de `Co-Authored-By` Claude dans les messages de commit.

## Workflow

- Un ticket = un focus
- `npm run typecheck`, `npm run test` et `npm run build` doivent passer
  avant tout commit
- En cas de doute sur le scope ou une décision : demander avant de coder

## Hors scope MVP (refuser proactivement si suggéré)

- Réouverture d'un tournoi terminé
- Multi-format de tournoi (élimination directe, poules + finales,
  double-élimination)
- Système d'amis et visibilité fine des profils (V2+)
- Statistiques avancées de confrontation, duos préférés, ELO,
  gamification (V2+)
- Export PDF, partage social
- Chat, notifications push
