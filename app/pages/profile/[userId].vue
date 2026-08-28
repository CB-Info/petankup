<script setup lang="ts">
// Page profil joueur (Phase K). Consomme le bundle chargé par le store
// (loadUserProfile, Phase J) : { profile, stats, results }.
//
// Chargement calqué sur tournaments/[tournamentId]/index.vue : flag local
// isLoadingProfile + token de course. On NE dérive PAS l'état "chargement"
// des seuls refs store car loadUserProfile vide currentProfileBundle au
// départ tout en laissant hasFetchedProfileBundle à true entre deux profils
// — sans flag local, une navigation profil→profil rendrait un bundle null.
//
// Header (mode interne) déclaré via useAppHeader, rendu une fois par le layout.

import type { UserTournamentResult } from "../../types";

const route = useRoute();
const profileStore = useProfileStore();
const { currentProfileBundle, lastLoadProfileBundleError, profileById } =
  storeToRefs(profileStore);
const identityStore = useIdentityStore();
const { currentUserId, identityUnavailable } = storeToRefs(identityStore);

const userId = computed(() => route.params.userId as string);

const profileIdIsValid = computed(() => isUuid(userId.value));

const isLoadingProfile = ref(true);

// Token local : seul le dernier load déclenché a le droit de remettre
// isLoadingProfile à false (anti-flip tardif sur navigation rapide).
let loadProfileRequestId = 0;

async function loadProfile(id: string): Promise<void> {
  const requestId = ++loadProfileRequestId;
  isLoadingProfile.value = true;
  try {
    await profileStore.loadUserProfile(id);
  } finally {
    if (requestId === loadProfileRequestId) {
      isLoadingProfile.value = false;
    }
  }
}

// Identité du viewer = identité canonique du store identity (user.sub, ou
// getClaims en repli dans la fenêtre post-magic-link) : une seule
// transition null → id, connue avant tout chargement de profil — sans elle,
// son propre journal s'afficherait d'abord sans liens puis basculerait
// sous le doigt.
const myUserId = currentUserId;
const isSelfProfile = computed(() => userId.value === myUserId.value);

// Chargement gated par l'identité du viewer (shouldReloadProfile) : à froid
// (F5, lien direct), l'identité n'est pas encore résolue au montage —
// appeler le store trop tôt sortirait silencieusement (sa garde) et la page
// afficherait « Profil introuvable » pour un simple état d'attente. On ne
// charge que sur transition réelle : premier passage identifié, résolution
// de l'identité, changement de profil ou de compte — jamais deux fois pour
// la même paire. isLoadingProfile (init true) reste affiché tant qu'aucun
// chargement réel n'a tranché ; sans session, la redirection /login du
// module fournit l'état terminal ; avec session mais identité indisponible
// (résolution en échec), c'est la branche d'erreur qui tranche (watcher plus
// bas). immediate : couvre le mount ET la réutilisation du composant sur
// changement de param de route.
watch(
  [userId, myUserId],
  (current, previous) => {
    // Garde amont, distincte du prédicat de timing : un id qui n'a pas la
    // forme d'un UUID ne peut désigner personne — introuvable immédiat,
    // sans requête (cf. profileIsNotFound côté template).
    if (!profileIdIsValid.value) {
      isLoadingProfile.value = false;
      return;
    }
    if (shouldReloadProfile(current, previous)) {
      void loadProfile(current[0]);
    }
  },
  { immediate: true },
);

// Convergence sans identité : quand la résolution échoue sans identité
// connue, le chargement n'aura pas lieu — on sort de l'état de chargement
// pour laisser la branche d'erreur (Réessayer) s'afficher.
watch(identityUnavailable, (unavailable) => {
  if (unavailable) isLoadingProfile.value = false;
});

// Réessayer : identité indisponible → relancer seulement la résolution (si
// elle aboutit, le watcher ci-dessus charge via shouldReloadProfile) ;
// sinon c'est le bundle qui a échoué → le recharger. Jamais les deux.
async function retryLoadProfile(): Promise<void> {
  if (currentUserId.value === null) {
    isLoadingProfile.value = true;
    await identityStore.resolveForCurrentSession();
    if (currentUserId.value === null) isLoadingProfile.value = false;
    return;
  }
  await loadProfile(userId.value);
}

// Accès dérivés non-null-safe : permettent à vue-tsc de narrower dans le
// template (v-if="profile") sans assertions, et fournissent stats/results à
// leur état par défaut quand le bundle est absent.
const profile = computed(() => currentProfileBundle.value?.profile ?? null);
const stats = computed(() => currentProfileBundle.value?.stats ?? null);
const results = computed(() => currentProfileBundle.value?.results ?? []);

// « Introuvable » recouvre deux causes, distinctes de l'état d'erreur :
// un id malformé (tranché sans appel), ou un chargement effectif revenu
// sans profil. Jamais pendant un chargement en cours, jamais sur une vraie
// panne — bundle en erreur ou identité indisponible — qui garde son écran
// d'erreur et son bouton Réessayer.
const profileIsNotFound = computed(
  () =>
    !profileIdIsValid.value ||
    (!isLoadingProfile.value &&
      lastLoadProfileBundleError.value === null &&
      !identityUnavailable.value &&
      profile.value === null),
);

// Noms affichés des coéquipiers d'une entrée (présentation pure) : pseudo
// live si le profil est résolu (pré-hydraté par loadUserProfile), sinon
// snapshot — même pattern que teamPlayersNames sur la page tournoi.
function teammateNamesFor(result: UserTournamentResult): string[] {
  return result.teammates.map((teammate) =>
    getTeammateDisplayName(teammate, profileById.value),
  );
}

// Mémorise l'origine AVANT la navigation vers le tournoi, pour que sa
// flèche retour ramène ici (et survive à un F5, cf. useTournamentOrigin).
// Ignoré si le clic ouvre un nouvel onglet (modificateur ou bouton non
// principal) : sessionStorage n'y est pas partagé, écrire ne ferait que
// polluer l'onglet courant d'une origine jamais consommée.
const { rememberProfileOrigin } = useTournamentOrigin();

function rememberJournalOrigin(event: MouseEvent, tournamentId: string): void {
  const opensOutsideThisTab =
    event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0;
  if (opensOutsideThisTab) return;
  rememberProfileOrigin(tournamentId, `/profile/${userId.value}`);
}

// Config header. watchEffect pour suivre le pseudo (arrive après le mount).
const { set: setHeader } = useAppHeader();
watchEffect(() => {
  setHeader({
    mode: "interne",
    kicker: "Profil",
    title: profile.value?.displayName ?? "Profil",
    back: { label: "Accueil", to: "/" },
  });
});

useHead({
  title: computed(() =>
    profile.value
      ? `${profile.value.displayName} — Pétankup`
      : "Profil — Pétankup",
  ),
});
</script>

<template>
  <div>
    <!-- Introuvable en tête de chaîne : couvre l'id malformé (tranché sans
         requête, même avec un bundle ou une erreur périmés d'une visite
         précédente) ET le profil réellement absent après chargement.
         profileIsNotFound est false pendant un chargement en cours — pas
         d'« introuvable » fugace pendant la résolution d'identité. -->
    <div
      v-if="profileIsNotFound"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Profil introuvable
      </h2>
      <UButton
        to="/"
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
      >
        Retour à l'accueil
      </UButton>
    </div>

    <p
      v-else-if="isLoadingProfile"
      class="py-16 text-center font-sans text-sm text-(--pk-subtle)"
    >
      Chargement du profil…
    </p>

    <div
      v-else-if="lastLoadProfileBundleError || identityUnavailable"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Impossible de charger le profil
      </h2>
      <p class="font-sans text-sm text-(--pk-subtle)">
        Vérifiez votre connexion et réessayez.
      </p>
      <UButton
        color="primary"
        block
        class="mt-2 h-13 rounded-[13px] font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
        @click="retryLoadProfile"
      >
        Réessayer
      </UButton>
    </div>

    <div v-else-if="profile" class="space-y-6">
      <!-- Hero : boule + pseudo + (soi uniquement) bouton Modifier -->
      <div class="flex flex-col items-center gap-3 pt-2 text-center">
        <BouleAvatar
          tone="gold"
          :size="96"
          :aria-label="`Profil de ${profile.displayName}`"
        >
          <span class="text-(--pk-navy)">
            {{ profile.displayName.charAt(0).toUpperCase() }}
          </span>
        </BouleAvatar>
        <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
          {{ profile.displayName }}
        </h2>
        <UButton
          v-if="isSelfProfile"
          to="/account"
          color="primary"
          variant="soft"
          icon="i-lucide-pencil"
          class="h-9.5 rounded-full bg-primary-100 px-4.5 font-disp text-[12.5px] font-extrabold tracking-[0.04em] uppercase"
          :ui="{ leadingIcon: 'size-3.5' }"
        >
          Modifier mes infos
        </UButton>
      </div>

      <ProfileStatsCards :stats="stats" />

      <section class="space-y-3">
        <h2
          class="font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
        >
          Journal de bord
        </h2>
        <p
          v-if="results.length === 0"
          class="font-sans text-sm text-(--pk-subtle)"
        >
          Aucun tournoi joué pour l'instant.
        </p>
        <!-- Une entrée est un lien SSI la base dit que le visiteur courant
             peut ouvrir ce tournoi (viewerCanOpen, dérivé par le RPC via le
             helper de visibilité — la base décide, l'interface obéit).
             Entrée non ouvrable : carte statique, sans aucun indicateur
             (signaler « privé » confirmerait l'existence d'un tournoi
             inaccessible). Sur son propre profil, tout est ouvrable
             (garantie H1.d) — aucune régression. -->
        <ul v-else class="space-y-2.75">
          <li v-for="result in results" :key="result.tournamentId">
            <!-- Pas d'aria-label : le nom accessible dérive du contenu de la
                 carte (rang, tournoi, date, bilan), comme les cartes-liens
                 de l'accueil. -->
            <NuxtLink
              v-if="result.viewerCanOpen"
              :to="`/tournaments/${result.tournamentId}`"
              class="block rounded-(--pk-r-card) transition-opacity hover:opacity-90 active:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              @click="rememberJournalOrigin($event, result.tournamentId)"
            >
              <ProfileJournalEntry
                :result="result"
                :teammate-names="teammateNamesFor(result)"
                interactive
              />
            </NuxtLink>
            <ProfileJournalEntry
              v-else
              :result="result"
              :teammate-names="teammateNamesFor(result)"
            />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
