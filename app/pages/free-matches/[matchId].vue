<script setup lang="ts">
// Page de détail d'un match libre (H2.b) : score final (vainqueur
// surligné), les deux camps et leurs joueurs — pseudo live si le profil est
// visible, sinon snapshot ; joueurs à compte en lien vers leur profil —,
// date et visibilité dans le header ; suppression par le créateur seul.
//
// Chargement calqué sur profile/[userId].vue : gaté sur l'identité du
// viewer via shouldReloadProfile (même problème de timing : ne charger que
// sur une transition réelle de la paire (id, viewer), jamais avant que
// l'identité soit connue), flag local isLoadingDetail + token de course,
// convergence sans identité via identityUnavailable.
//
// Header (mode interne) déclaré via useAppHeader, rendu une fois par le layout.
import type { CarteEquipePlayer } from "../../components/CarteEquipe.vue";
import type { FreeMatch, FreeMatchSide, FreeMatchVisibility } from "../../types";
import {
  FREE_MATCH_FORMAT_LABELS,
  freeMatchFormatOf,
  playersOnSide,
  winnerSideOf,
} from "../../utils/free-match";
import { shouldReloadProfile } from "../../utils/profile-load";

const route = useRoute();
const freeMatchStore = useFreeMatchStore();
const { currentFreeMatch, lastLoadFreeMatchError, isCreatorOfCurrentFreeMatch } =
  storeToRefs(freeMatchStore);
const profileStore = useProfileStore();
const { profileById } = storeToRefs(profileStore);
const identityStore = useIdentityStore();
const { currentUserId, identityUnavailable, lastResolveError } =
  storeToRefs(identityStore);
const { showError } = useErrorToast();
const toast = useToast();

const matchId = computed(() => route.params.matchId as string);

const matchIdIsValid = computed(() => isUuid(matchId.value));

const isLoadingDetail = ref(true);

// Token local : seul le dernier chargement déclenché a le droit de remettre
// isLoadingDetail à false (anti-flip tardif sur navigation rapide).
let loadDetailRequestId = 0;

async function loadDetail(id: string): Promise<void> {
  const requestId = ++loadDetailRequestId;
  isLoadingDetail.value = true;
  try {
    await freeMatchStore.loadFreeMatch(id);
  } finally {
    if (requestId === loadDetailRequestId) {
      isLoadingDetail.value = false;
    }
  }
}

// Id malformé : « Match introuvable » immédiat, sans requête (le cast uuid
// échouerait côté base — erreur technique présentée à tort comme une
// panne). immediate : couvre le mount ET la réutilisation du composant sur
// changement de param de route.
watch(
  [matchId, currentUserId],
  (current, previous) => {
    if (!matchIdIsValid.value) {
      isLoadingDetail.value = false;
      return;
    }
    if (shouldReloadProfile(current, previous)) {
      void loadDetail(current[0]);
    }
  },
  { immediate: true },
);

// Convergence sans identité : la résolution a échoué sans identité connue,
// le chargement n'aura pas lieu — on sort de l'état de chargement pour
// laisser la branche d'erreur (Réessayer) s'afficher.
watch(identityUnavailable, (unavailable) => {
  if (unavailable) isLoadingDetail.value = false;
});

async function retryLoadDetail(): Promise<void> {
  if (currentUserId.value === null) {
    isLoadingDetail.value = true;
    await identityStore.resolveForCurrentSession();
    if (currentUserId.value === null) isLoadingDetail.value = false;
    return;
  }
  await loadDetail(matchId.value);
}

// Match affiché : celui du store, s'il correspond bien à la route.
const freeMatch = computed<FreeMatch | null>(() => {
  const loaded = currentFreeMatch.value;
  return loaded !== null && loaded.id === matchId.value ? loaded : null;
});

// Erreur affichée : échec du chargement, ou identité indisponible.
const detailError = computed(
  () =>
    lastLoadFreeMatchError.value ??
    (identityUnavailable.value ? lastResolveError.value : null),
);

// « Introuvable » : id malformé (tranché sans appel), ou chargement revenu
// sans match (inexistant, ou invisible via RLS). Jamais pendant un
// chargement, jamais sur une vraie panne.
const matchIsNotFound = computed(
  () =>
    !matchIdIsValid.value ||
    (!isLoadingDetail.value &&
      detailError.value === null &&
      freeMatch.value === null),
);

// --- Présentation ---

const VISIBILITY_LABELS: Record<FreeMatchVisibility, string> = {
  private: "Privé",
  public: "Public",
};

const winnerSide = computed(() =>
  freeMatch.value
    ? winnerSideOf(freeMatch.value.scoreA, freeMatch.value.scoreB)
    : null,
);

const formatLabel = computed(() => {
  const format = freeMatch.value ? freeMatchFormatOf(freeMatch.value.players) : null;
  return format === null ? "Match libre" : FREE_MATCH_FORMAT_LABELS[format];
});

const headerSubtitle = computed(() =>
  freeMatch.value
    ? `${formatDate(freeMatch.value.playedOn)} · ${VISIBILITY_LABELS[freeMatch.value.visibility]}`
    : "",
);

// Joueurs d'un camp pour CarteEquipe : nom résolu ici (pseudo live si le
// profil est hydraté, sinon snapshot), userId pour le lien profil.
function cardPlayersOf(side: FreeMatchSide): CarteEquipePlayer[] {
  const players = freeMatch.value?.players ?? [];
  return playersOnSide(players, side).map((player) => ({
    displayName: getPlayerDisplayName(player, profileById.value),
    userId: player.userId,
  }));
}

const sideACardPlayers = computed(() => cardPlayersOf("A"));
const sideBCardPlayers = computed(() => cardPlayersOf("B"));

// Hydratation best-effort des pseudos live des joueurs à compte.
// loadProfilesByIds dédupe, filtre le cache et ne throw jamais. Sur un match
// privé, les co-participants sans tournoi commun restent invisibles (RLS
// profils) : leur snapshot s'affiche — signalé, hors périmètre ici.
watch(
  freeMatch,
  (match) => {
    if (match === null) return;
    const linkedUserIds = match.players
      .map((player) => player.userId)
      .filter((userId): userId is string => userId !== null);
    if (linkedUserIds.length > 0) void profileStore.loadProfilesByIds(linkedUserIds);
  },
  { immediate: true },
);

// --- Suppression (créateur seul) ---

const deleteModalOpen = ref(false);
const isDeleting = ref(false);

// Garde d'opener = droit d'agir (créateur), en plus du masquage de l'action
// dans le header.
function askDeleteConfirmation() {
  if (!isCreatorOfCurrentFreeMatch.value) return;
  deleteModalOpen.value = true;
}

// Si le droit disparaît modale ouverte (changement de compte), on la ferme.
watch(isCreatorOfCurrentFreeMatch, (canDelete) => {
  if (!canDelete) deleteModalOpen.value = false;
});

async function confirmDelete() {
  if (isDeleting.value) return;
  isDeleting.value = true;
  try {
    await freeMatchStore.deleteFreeMatch(matchId.value);
    deleteModalOpen.value = false;
    toast.add({
      title: "Match supprimé",
      color: "success",
      icon: "i-lucide-check",
    });
    await navigateTo("/");
  } catch (error) {
    showError(error);
  } finally {
    isDeleting.value = false;
  }
}

// Config header. Pas de header sur les états chargement / introuvable /
// erreur (comme la page tournoi) : on mirror la branche valide du template.
const { set: setHeader, clear: clearHeader } = useAppHeader();
watchEffect(() => {
  const match = freeMatch.value;
  if (isLoadingDetail.value || match === null) {
    clearHeader();
    return;
  }
  setHeader({
    mode: "interne",
    back: { label: "Accueil", to: "/" },
    kicker: "● Match libre",
    title: formatLabel.value,
    subtitle: headerSubtitle.value,
    actions: isCreatorOfCurrentFreeMatch.value
      ? [
          {
            id: "delete",
            icon: "i-lucide-trash-2",
            ariaLabel: "Supprimer le match",
            onClick: askDeleteConfirmation,
          },
        ]
      : [],
  });
});

useHead(() => ({
  title: freeMatch.value
    ? `${formatLabel.value} — Pétankup`
    : "Match libre — Pétankup",
}));
</script>

<template>
  <div>
    <div
      v-if="matchIsNotFound"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Match introuvable
      </h2>
      <p class="font-sans text-sm text-(--pk-subtle)">
        Ce match n'existe pas ou ne vous est pas visible.
      </p>
      <UButton
        to="/"
        color="primary"
        block
        class="mt-2 h-13 rounded-[13px] font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
      >
        Retour à l'accueil
      </UButton>
    </div>

    <p
      v-else-if="isLoadingDetail"
      class="py-16 text-center font-sans text-sm text-(--pk-subtle)"
    >
      Chargement…
    </p>

    <div
      v-else-if="detailError"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Impossible de charger le match
      </h2>
      <p class="font-sans text-sm text-(--pk-subtle)">
        Vérifiez votre connexion et réessayez.
      </p>
      <UButton
        color="primary"
        block
        class="mt-2 h-13 rounded-[13px] font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
        @click="retryLoadDetail"
      >
        Réessayer
      </UButton>
      <UButton
        to="/"
        variant="ghost"
        color="neutral"
        block
        class="h-11"
      >
        Retour à l'accueil
      </UButton>
    </div>

    <div v-else-if="freeMatch" class="space-y-5">
      <ScoreboardEquipe
        mode="liste"
        team-a-name="Camp A"
        team-b-name="Camp B"
        :score-a="freeMatch.scoreA"
        :score-b="freeMatch.scoreB"
        :winner-side="winnerSide"
        :can-score="false"
      />

      <section class="space-y-2.75">
        <h2
          class="font-disp text-[11px] font-extrabold tracking-[0.14em] uppercase text-(--pk-subtle)"
        >
          Joueurs
        </h2>
        <CarteEquipe
          name="Camp A"
          :players="sideACardPlayers"
          :show-actions="false"
        />
        <CarteEquipe
          name="Camp B"
          :players="sideBCardPlayers"
          :show-actions="false"
        />
      </section>

      <FreeMatchDeleteConfirmModal
        v-model:open="deleteModalOpen"
        :is-submitting="isDeleting"
        @confirmed="confirmDelete"
      />
    </div>
  </div>
</template>
