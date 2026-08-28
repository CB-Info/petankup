<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
//
// L'identité est résolue au boot par le store identity (plugin). La page
// tire ce qu'elle affiche — liste des tournois et profil courant — dès que
// l'identité est connue (watcher ci-dessous), puis observe
// hasFetchedTournaments / l'erreur affichée et fournit un retry manuel.
//
// Header (mode accueil) déclaré via useAppHeader et rendu une fois par le
// layout. La déconnexion reste accessible via /account (pastille profil).
import type { TournamentStatus } from "../types";

const tournamentStore = useTournamentStore();
const {
  myTournaments,
  sharedTournaments,
  publicTournaments,
  hasFetchedTournaments,
  lastLoadTournamentsError,
} = storeToRefs(tournamentStore);
const profileStore = useProfileStore();
const { profileById, currentProfile } = storeToRefs(profileStore);
const identityStore = useIdentityStore();
const { currentUserId, identityUnavailable, lastResolveError } =
  storeToRefs(identityStore);
const { showError } = useErrorToast();

// Chargement gaté sur l'identité : liste des tournois + profil courant
// (pastille du header). Les deux actions sont idempotentes et dédupliquent
// leurs requêtes en vol ; `void` : fire-and-forget, elles ne throw pas.
// immediate : couvre le boot (identité déjà connue ou non) et le changement
// de compte.
watch(
  currentUserId,
  (userId) => {
    if (userId === null) return;
    void tournamentStore.loadTournamentsForCurrentSession();
    void profileStore.loadCurrentProfile();
  },
  { immediate: true },
);

// Erreur affichée par la branche d'erreur : échec du chargement des
// tournois, ou identité indisponible (résolution en échec sans identité
// connue — jamais une erreur d'identité par-dessus des données valides).
const homeError = computed(
  () =>
    lastLoadTournamentsError.value ??
    (identityUnavailable.value ? lastResolveError.value : null),
);

// Initiale de la pastille profil du header. Pastille vide (valeur neutre)
// le temps du chargement du profil courant.
const profileInitial = computed(() =>
  (currentProfile.value?.displayName ?? "").charAt(0).toUpperCase(),
);

// Pastille profil → MON profil public (sens de navigation inversé : le
// compte s'atteint depuis le profil). Identité canonique du store identity ;
// dernier recours : /account.
function goToMyProfile() {
  const myUserId = currentUserId.value;
  void navigateTo(myUserId ? `/profile/${myUserId}` : "/account");
}

// Config header (mode accueil). watchEffect pour que l'initiale se mette à
// jour quand le profil s'hydrate.
const { set: setHeader } = useAppHeader();
watchEffect(() => {
  setHeader({
    mode: "accueil",
    profileInitial: profileInitial.value,
    onProfile: goToMyProfile,
  });
});
// TODO bloc tournoi-en-cours : à brancher quand le store exposera
// matchsJoues/matchsTotal/equipes du tournoi in_progress (prop `tournoi`
// d'AppHeader, cf. HeaderTournoi) — l'ajouter à la config ci-dessus.

const isRetrying = ref(false);

async function retryLoadTournaments() {
  if (isRetrying.value) return;
  isRetrying.value = true;
  try {
    // Identité indisponible (getClaims en échec) : on relance seulement la
    // résolution — si elle aboutit, le watcher ci-dessus charge. Sinon
    // l'identité est connue et c'est le chargement lui-même qui a échoué :
    // on le relance. Jamais les deux, pour ne pas doubler les requêtes.
    if (currentUserId.value === null) {
      await identityStore.resolveForCurrentSession();
      return;
    }
    await tournamentStore.loadTournamentsForCurrentSession();
  } catch (error) {
    showError(error);
  } finally {
    isRetrying.value = false;
  }
}

// Ordre d'affichage : en cours d'abord (ce qui se passe maintenant),
// puis brouillons (à finir de préparer), puis terminés (archivés).
const STATUS_DISPLAY_ORDER: Record<TournamentStatus, number> = {
  in_progress: 0,
  draft: 1,
  completed: 2,
};

const sortedMyTournaments = computed(() => {
  return [...myTournaments.value].sort((firstTournament, secondTournament) => {
    const statusDiff =
      STATUS_DISPLAY_ORDER[firstTournament.status] -
      STATUS_DISPLAY_ORDER[secondTournament.status];
    if (statusDiff !== 0) return statusDiff;
    // Date desc : la plus récente en premier (les ISO se comparent comme du texte).
    return secondTournament.date.localeCompare(firstTournament.date);
  });
});

// Tournois partagés (je suis invité, pas owner) : pas de tri par status
// (le membre est spectateur, pas admin — la notion de progression
// d'organisateur n'a pas de sens ici), juste date desc.
const sortedSharedTournaments = computed(() => {
  return [...sharedTournaments.value].sort(
    (firstTournament, secondTournament) =>
      secondTournament.date.localeCompare(firstTournament.date),
  );
});

// Tournois publics d'autres owners : pas de tri par status (lecture
// pure, pas de notion de progression d'admin), juste date desc.
const sortedPublicTournaments = computed(() => {
  return [...publicTournaments.value].sort(
    (firstTournament, secondTournament) =>
      secondTournament.date.localeCompare(firstTournament.date),
  );
});

// Owners des tournois où je ne suis pas l'organisateur (partagés +
// publics). Mes propres tournois sont exclus : j'en suis l'owner, on
// n'affiche pas "Organisé par moi".
const ownerIdsToHydrate = computed(() => {
  const ownerIds = new Set<string>();
  for (const tournament of sortedSharedTournaments.value) {
    ownerIds.add(tournament.ownerId);
  }
  for (const tournament of sortedPublicTournaments.value) {
    ownerIds.add(tournament.ownerId);
  }
  return [...ownerIds];
});

// Hydratation best-effort du cache des profils. loadProfilesByIds est
// idempotent (dédupe + exclut le cache) et ne throw jamais ; le `void`
// est fire-and-forget pour ne pas bloquer le rendu de la home.
watch(
  ownerIdsToHydrate,
  (ownerIds) => {
    if (ownerIds.length > 0) void profileStore.loadProfilesByIds(ownerIds);
  },
  { immediate: true },
);

// Nom de l'organisateur si son profil est déjà résolu, sinon null (la
// ligne "Organisé par" est alors omise — pas de placeholder).
function organizerName(ownerId: string): string | null {
  return profileById.value[ownerId]?.displayName ?? null;
}

const mineEmpty = computed(() => sortedMyTournaments.value.length === 0);
const sharedEmpty = computed(() => sortedSharedTournaments.value.length === 0);
const publicEmpty = computed(() => sortedPublicTournaments.value.length === 0);
const allEmpty = computed(
  () => mineEmpty.value && sharedEmpty.value && publicEmpty.value,
);

// Sous-info d'une CarteTournoi : « date · lieu », complétée du nom de
// l'organisateur pour les tournois partagés/publics quand son profil est
// résolu. Le statut n'y figure pas (porté par le label de la carte).
function tournamentSubInfo(
  tournament: { date: string; location?: string; ownerId: string },
  withOrganizer = false,
): string {
  const parts = [formatDate(tournament.date)];
  if (tournament.location) parts.push(tournament.location);
  if (withOrganizer) {
    const organizer = organizerName(tournament.ownerId);
    if (organizer) parts.push(`Par ${organizer}`);
  }
  return parts.join(" · ");
}

useHead({ title: "Pétankup — Gestion de tournois" });
</script>

<template>
  <div>
    <div
      v-if="homeError"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Impossible de charger les tournois
      </h2>
      <p class="font-sans text-sm text-(--pk-subtle)">
        Vérifiez votre connexion et réessayez.
      </p>
      <UButton
        color="primary"
        block
        :loading="isRetrying"
        class="mt-2 h-13 rounded-[13px] font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
        @click="retryLoadTournaments"
      >
        Réessayer
      </UButton>
    </div>

    <p
      v-else-if="!hasFetchedTournaments"
      class="py-16 text-center font-sans text-sm text-(--pk-subtle)"
    >
      Chargement…
    </p>

    <div
      v-else-if="allEmpty"
      class="flex flex-col items-center gap-3 py-8 text-center"
    >
      <BouleAvatar tone="gold" :size="64" />
      <p class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Aucun tournoi pour l'instant
      </p>
      <p class="font-sans text-sm text-(--pk-subtle)">
        Créez votre premier tournoi de pétanque
      </p>
      <UButton
        to="/tournaments/new"
        color="primary"
        icon="i-lucide-plus"
        block
        class="mt-2 h-13 rounded-[13px] font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
        :ui="{ leadingIcon: 'size-4.5' }"
      >
        Créer un tournoi
      </UButton>
    </div>

    <div v-else class="space-y-6">
      <section>
        <div class="mb-3 flex items-center justify-between">
          <h2
            class="font-disp text-[11px] font-extrabold tracking-[0.14em] uppercase text-(--pk-subtle)"
          >
            Tous les tournois
          </h2>
          <UButton
            to="/tournaments/new"
            color="navy"
            icon="i-lucide-plus"
            class="h-7.75 gap-1.5 rounded-[10px] px-3.25 font-disp text-xs font-extrabold tracking-[0.04em] uppercase"
            :ui="{ leadingIcon: 'size-3.75' }"
          >
            Nouveau
          </UButton>
        </div>
        <ul v-if="!mineEmpty" class="space-y-2.75">
          <li
            v-for="tournament in sortedMyTournaments"
            :key="tournament.id"
          >
            <NuxtLink :to="`/tournaments/${tournament.id}`" class="block">
              <CarteTournoi
                :name="tournament.name"
                :sub-info="tournamentSubInfo(tournament)"
                :status="tournament.status"
              />
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section v-if="!sharedEmpty">
        <h2
          class="mb-3 font-disp text-[11px] font-extrabold tracking-[0.14em] uppercase text-(--pk-subtle)"
        >
          Partagés avec moi
        </h2>
        <ul class="space-y-2.75">
          <li
            v-for="tournament in sortedSharedTournaments"
            :key="tournament.id"
          >
            <NuxtLink :to="`/tournaments/${tournament.id}`" class="block">
              <CarteTournoi
                :name="tournament.name"
                :sub-info="tournamentSubInfo(tournament, true)"
                :status="tournament.status"
              />
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section v-if="!publicEmpty">
        <h2
          class="mb-3 font-disp text-[11px] font-extrabold tracking-[0.14em] uppercase text-(--pk-subtle)"
        >
          Tournois publics
        </h2>
        <ul class="space-y-2.75">
          <li
            v-for="tournament in sortedPublicTournaments"
            :key="tournament.id"
          >
            <NuxtLink :to="`/tournaments/${tournament.id}`" class="block">
              <CarteTournoi
                :name="tournament.name"
                :sub-info="tournamentSubInfo(tournament, true)"
                :status="tournament.status"
              />
            </NuxtLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
