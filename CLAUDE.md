# Pétanque Tournament Manager

Application web mobile-first de gestion de parties et de tournois de
pétanque, destinée au grand public (joueurs d'abord, clubs à terme).
Persistance Supabase, auth magic link et Google OAuth.

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

## Charte graphique — « Nuit & Corail »

Mode clair forcé (le dark mode est supprimé). L'identité repose sur un navy profond pour les en-têtes et écrans de célébration, un corail (clay) pour les actions, du doré pour les accents (avatars, podium, classement), sur des surfaces crème.

### Polices

Trois familles, déclarées en variables CSS (`main.css`) et exposées en utilitaires Tailwind :

- **`font-disp` = Archivo** — titres, kickers, labels, boutons, stats (bold/extrabold, souvent capitales + letter-spacing).
- **`font-sans` = Hanken Grotesk** — corps de texte (police par défaut).
- **`font-num` = Space Grotesk** — scores et gros chiffres tabulaires.

### Couleurs de marque = tokens sémantiques Nuxt UI

Mappées sur les rôles sémantiques dans `app/app.config.ts` (ne pas les redéfinir ailleurs) :

- **primary = clay (corail) `#E0654E`** — actions principales, CTA, sélection active.
- **secondary = gold (doré) `#E2B45A`** — avatars, accents podium/classement, kickers dorés.
- **success = green `#2F7D5E`** — différentiels positifs, taux de victoire.
- **error = danger `#B23B45`** — erreurs, suppression.

Ces quatre rôles ont leurs rampes complètes (50→950). **Ne jamais créer de tokens `--pk-clay` / `--pk-gold` / `--pk-green`** qui dupliqueraient les rôles sémantiques.

### Navy, dégradés, neutres = variables `--pk-*` (dans `main.css`)

Le navy est une couleur d'ambiance (pas de rampe sémantique). Variables `--pk-*`, à utiliser via `bg-(--pk-…)` / `text-(--pk-…)` :

**Navy & profondeur** — `--pk-navy: #1F2542` · `--pk-navy-top: #2B3357` · `--pk-navy-mid: #3B4570` · `--pk-navy-deep: #12152A`

**Surfaces claires** — `--pk-page: #F0ECE6` (fond) · `--pk-card: #FBF8F3` (cartes) · `--pk-cream: #FBF6EE` (crème) · `--pk-line: #E5E1D9` (bordures)

**Texte** — `--pk-ink: #232231` (fort) · `--pk-subtle: #605E6E` (secondaire) · `--pk-muted: #97939E` (atténué)

**Texte sur navy** — `--pk-cream` · `--pk-on-navy-2: #A9C4CB` · `--pk-on-navy-3: #88A6AE` · `--pk-on-navy: #E6EEF0` (blanc froid système). Voiles : `--pk-on-navy-08` (onglet inactif) · `--pk-on-navy-10` (croix).

**Dégradés navy (prêts)** — `--pk-grad-header` (en-têtes) · `--pk-grad-login` (connexion) · `--pk-grad-podium` (podium).

**Canaux RGB (ombres composées)** — `--pk-clay-rgb: 224 101 78` · `--pk-gold-rgb: 226 180 90` · `--pk-navy-rgb: 31 37 66`.

### Ombres & rayons (tokens)

- Ombres : `--pk-shadow-card`, `--pk-shadow-card-lg`, `--pk-shadow-clay-sm`, `--pk-shadow-clay-lg`, `--pk-shadow-select-active`, `--pk-shadow-medallion` (liste exacte dans `main.css`).
- Rayons : `--pk-r-header: 24px` · `--pk-r-panel: 18px` · `--pk-r-card: 16px` · `--pk-r-md: 12px` · `--pk-r-sm: 10px`.

### Boutons

`UButton` pour toute action (`color`/`variant`). Variantes custom déclarées **une seule fois** dans `app.config.ts` (scopées au bouton, pas des couleurs globales) :

- `color="navy"` — bouton navy (ex. « Terminer le tournoi »).
- `color="cream"` — bouton clair sur navy (Google, sheets/modales).
- `variant="dashed"` (sur `color="primary"`) — bordure pointillée corail (« Ajouter une équipe », « Se déconnecter »).

Contrôles **identitaires à état** (pastilles navy translucides, onglets actif/inactif, steppers meneur) = `<button>` natifs (le navy n'a pas de rampe 50→950 exprimable par `UButton`).

### Composants Direction C (design system maison)

`AppHeader`, `BouleAvatar` (+ util `medalTone`), `StatutBadge`, `CarteTournoi`, `CarteEquipe`, `ScoreboardEquipe`, `LigneClassement` (+ `LigneClassementEntete`), `CarteSelection`, `GoogleLogo`. **Audit Nuxt UI obligatoire avant tout nouveau composant maison.**

### Règles de couleur transverses

- DIFF positif → `success` ; DIFF négatif → `primary` (corail), pas de token dédié.
- Une seule source par couleur : utiliser le rôle sémantique s'il existe ; ne créer un `--pk-*` que pour navy/neutres/dégradés/ombres.
- Orphelins (couleur hors palette dans une maquette) : mapper sur le token existant le plus proche ; nouveau token seulement après validation.

### Mobile-first

- Layouts en colonne unique sur mobile
- Boutons full-width (w-full)
- Touch targets min 44px
- Pas de hover-only — tout au tap
- Texte min 14px

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

Règle STRICTE, exprimée une seule fois côté app dans `app/utils/score.ts`
(`WINNING_SCORE`, `validateMatchScore`, `clampScoreToInputBounds`) et
consommée par les deux domaines (tournoi et match libre) — les CHECK en
base restent le filet, jamais la première ligne :

- Les deux scores sont des entiers ≥ 0
- `max(scoreA, scoreB) === 13` : le vainqueur a exactement 13 points,
  le perdant de 0 à 12
- `scoreA !== scoreB` (pas de match nul à la pétanque)
- Les steppers de saisie sont bornés [0, 13] nativement par
  `ScoreboardEquipe` (jamais les props d'affichage) ; la saisie clavier
  est validée à la soumission

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
- Cycle de vie : Brouillon → En cours (au démarrage) → Terminé (à la
  complétion). Un tournoi Terminé est **gelé en base** — verrou livré
  (migration `20260819190000_tournament_freeze`) : scores, équipes,
  joueurs et métadonnées immuables. Deux exceptions : le changement de
  **visibilité** et la **suppression** par l'owner (cohérence des stats
  garantie). **Réouverture** Terminé → En cours possible **en base
  uniquement** (aucune UI à ce jour, choix assumé) : les stats
  matérialisées sont retirées à la réouverture et recalculées à la
  re-complétion. Jamais de retour en Brouillon.
- Deux visibilités : `private` (par défaut : owner + membres invités)
  ou `public` (visible de tous les utilisateurs authentifiés).
  Modifiable à tout moment, y compris sur un tournoi terminé
  (exception au gel).
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
- ❌ Contourner le gel d'un tournoi `terminé` — invariant produit,
  verrou en place côté base (seules exceptions : visibilité,
  suppression, réouverture vers `en cours`)

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

- Multi-format de tournoi (élimination directe, poules + finales,
  double-élimination)
- Système d'amis et visibilité fine des profils (V2+)
- Statistiques avancées de confrontation, duos préférés, ELO,
  gamification (V2+)
- Export PDF, partage social
- Chat, notifications push
