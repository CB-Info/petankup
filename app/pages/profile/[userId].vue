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

import type { Teammate, UserTournamentResult } from "../../types";
import { buildUnifiedJournal, filterJournal } from "../../utils/journal";
import type { JournalFilter } from "../../utils/journal";

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

// --- Statut d'amitié (A3) : dérivé du bundle du store friendship, chargé
// LAZY (gratuit si l'écran des amis ou le compte l'ont déjà chargé). Le
// bloc n'est rendu que bundle en place : statut inconnu → silence, pas
// d'écran d'erreur pour un bloc secondaire. Sur son propre profil, la
// branche v-if="isSelfProfile" du hero rend ce bloc structurellement
// inatteignable.
const friendshipStore = useFriendshipStore();
const { friendshipBundle } = storeToRefs(friendshipStore);
const { isActionPending } = friendshipStore;
const {
  decodeFriendshipErrorCode,
  showFriendshipError,
  showRequestOutcome,
  showQuietConfirmation,
} = useFriendshipFeedback();
const toast = useToast();

watch(
  currentUserId,
  (viewerId) => {
    if (viewerId !== null) void friendshipStore.loadFriendships();
  },
  { immediate: true },
);

const friendshipStatus = computed(() =>
  friendshipStore.friendshipStatusOf(userId.value),
);

// Demande depuis le profil : la RPC ne connaît que le PSEUDO (manque A1
// consigné) — si la personne s'est renommée depuis le chargement du
// bundle, display_name_not_found reçoit une copie dédiée à cet écran (le
// message générique « Aucun compte ne porte ce pseudo » serait absurde sur
// la page de la personne).
const isSubmittingFriendRequest = ref(false);

async function requestFromProfile(displayName: string) {
  if (isSubmittingFriendRequest.value) return;
  isSubmittingFriendRequest.value = true;
  try {
    const outcome = await friendshipStore.requestFriendship(displayName);
    showRequestOutcome(outcome);
  } catch (error) {
    const code = decodeFriendshipErrorCode(error);
    if (code === "display_name_not_found") {
      toast.add({
        title: "Ce joueur n'est plus joignable sous ce pseudo. Rechargez la page.",
        color: "warning",
        icon: "i-lucide-info",
      });
      return;
    }
    showFriendshipError(error, "request");
  } finally {
    isSubmittingFriendRequest.value = false;
  }
}

async function acceptFromProfile() {
  try {
    await friendshipStore.acceptFriendship(userId.value);
  } catch (error) {
    showFriendshipError(error, "accept");
  }
}

async function refuseFromProfile() {
  try {
    await friendshipStore.refuseFriendship(userId.value);
  } catch (error) {
    showFriendshipError(error, "refuse");
  }
}

async function cancelFromProfile() {
  try {
    await friendshipStore.cancelFriendshipRequest(userId.value);
  } catch (error) {
    showFriendshipError(error, "cancel");
  }
}

const isRemovalModalOpen = ref(false);

async function confirmRemovalFromProfile() {
  try {
    await friendshipStore.removeFriendship(userId.value);
    isRemovalModalOpen.value = false;
    showQuietConfirmation();
  } catch (error) {
    showFriendshipError(error, "remove");
  }
}

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
const freeMatches = computed(
  () => currentProfileBundle.value?.freeMatches ?? [],
);
const freeMatchStats = computed(
  () => currentProfileBundle.value?.freeMatchStats ?? null,
);

// Journal unifié (S5) : tournois et matchs libres mêlés, triés par jour de
// jeu (fusion à l'affichage, cf. utils/journal.ts), plus un filtre par
// type toujours visible.
const journalFilter = ref<JournalFilter>("all");

const JOURNAL_FILTER_OPTIONS: Array<{ value: JournalFilter; label: string }> = [
  { value: "all", label: "Tout" },
  { value: "tournaments", label: "Tournois" },
  { value: "free_matches", label: "Matchs libres" },
];

const journalEntries = computed(() =>
  buildUnifiedJournal(results.value, freeMatches.value),
);

const visibleEntries = computed(() =>
  filterJournal(journalEntries.value, journalFilter.value),
);

// Message de la liste vide : journal entièrement vide, ou filtre sans
// résultat — jamais une liste vide sans explication.
const journalEmptyMessage = computed(() => {
  if (journalEntries.value.length === 0) {
    return "Aucune partie dans le journal pour l'instant.";
  }
  if (journalFilter.value === "tournaments") {
    return "Aucun tournoi dans le journal.";
  }
  return "Aucun match libre dans le journal.";
});

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
  return playerNamesFor(result.teammates);
}

// Même résolution pour les joueurs d'un match libre (teammates/opponents
// partagent la forme Teammate).
function playerNamesFor(players: Teammate[]): string[] {
  return players.map((player) =>
    getTeammateDisplayName(player, profileById.value),
  );
}

// Mémorise l'origine AVANT la navigation vers un tournoi ou un match
// libre, pour que sa flèche retour ramène ici (et survive à un F5, cf.
// useBackOrigin). Un seul handler, sans domaine : la branche du journal
// passe le chemin de base du contexte de destination. Ignoré si le clic
// ouvre un nouvel onglet (modificateur ou bouton non principal) :
// sessionStorage n'y est pas partagé, écrire ne ferait que polluer
// l'onglet courant d'une origine jamais consommée.
const { rememberOrigin, readOrigin, clearOrigin } = useBackOrigin();

function rememberJournalOrigin(event: MouseEvent, contextBasePath: string): void {
  const opensOutsideThisTab =
    event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0;
  if (opensOutsideThisTab) return;
  rememberOrigin(contextBasePath, `/profile/${userId.value}`);
}

// Flèche retour contextuelle (A3) : arriver depuis l'écran des amis fait
// ramener la flèche vers « Amis », sinon Accueil. Motif canonique des
// pages tournoi et match libre : lecture au watch d'id (clear du contexte
// précédent sur changement de param), consommation à la SORTIE du contexte
// — la flèche ne ment jamais, quitte à retomber sur Accueil après un
// détour profil → tournoi → retour.
const DEFAULT_BACK_LINK = { label: "Accueil", to: "/" };
const headerBackLink = ref(DEFAULT_BACK_LINK);

watch(
  userId,
  (id, previousId) => {
    if (previousId !== undefined) clearOrigin(`/profile/${previousId}`);
    headerBackLink.value = readOrigin(`/profile/${id}`) ?? DEFAULT_BACK_LINK;
  },
  { immediate: true },
);

onBeforeRouteLeave((to) => {
  const profileBasePath = `/profile/${userId.value}`;
  if (!pathBelongsToContext(to.path, profileBasePath)) {
    clearOrigin(profileBasePath);
  }
});

// Config header. watchEffect pour suivre le pseudo (arrive après le mount).
const { set: setHeader } = useAppHeader();
watchEffect(() => {
  setHeader({
    mode: "interne",
    kicker: "Profil",
    title: profile.value?.displayName ?? "Profil",
    back: headerBackLink.value,
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

        <!-- Statut d'amitié + action (A3) — profil d'autrui seulement, et
             seulement une fois le bundle d'amitié en place (statut inconnu
             → silence). -->
        <template v-else-if="friendshipBundle !== null">
          <div
            v-if="friendshipStatus === 'friends'"
            class="flex items-center gap-2.5"
          >
            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-(--pk-cream) px-3 py-1.5 font-disp text-[11px] font-extrabold tracking-[0.06em] uppercase text-(--pk-subtle)"
            >
              <UIcon name="i-lucide-check" class="size-3.5" />
              Amis
            </span>
            <UButton
              variant="ghost"
              color="error"
              :loading="isActionPending(userId, 'remove')"
              class="h-11 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase"
              @click="isRemovalModalOpen = true"
            >
              Retirer
            </UButton>
          </div>

          <div
            v-else-if="friendshipStatus === 'request_sent'"
            class="flex items-center gap-2.5"
          >
            <span class="font-sans text-sm text-(--pk-subtle)">Demande envoyée</span>
            <UButton
              variant="ghost"
              color="neutral"
              :loading="isActionPending(userId, 'cancel')"
              class="h-11 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase"
              @click="cancelFromProfile"
            >
              Annuler la demande
            </UButton>
          </div>

          <div
            v-else-if="friendshipStatus === 'request_received'"
            class="flex flex-col items-center gap-2"
          >
            <span class="font-sans text-sm text-(--pk-subtle)">Vous a envoyé une demande</span>
            <div class="flex gap-1.5">
              <UButton
                color="primary"
                :loading="isActionPending(userId, 'accept')"
                :disabled="isActionPending(userId)"
                class="h-11 rounded-[12px] px-4 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase text-(--pk-cream)"
                @click="acceptFromProfile"
              >
                Accepter
              </UButton>
              <UButton
                variant="ghost"
                color="neutral"
                :loading="isActionPending(userId, 'refuse')"
                :disabled="isActionPending(userId)"
                class="h-11 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase"
                @click="refuseFromProfile"
              >
                Refuser
              </UButton>
            </div>
          </div>

          <UButton
            v-else-if="friendshipStatus === 'none'"
            color="primary"
            :loading="isSubmittingFriendRequest"
            class="h-11 rounded-full px-4.5 font-disp text-[12.5px] font-extrabold tracking-[0.04em] uppercase text-(--pk-cream)"
            @click="requestFromProfile(profile.displayName)"
          >
            Envoyer une demande
          </UButton>
        </template>
      </div>

      <ProfileStatsCards :stats="stats" :free-match-stats="freeMatchStats" />

      <section class="space-y-3">
        <h2
          class="font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
        >
          Journal de bord
        </h2>
        <!-- Filtre par type, toujours visible (S5). -->
        <FiltrePilules
          v-model="journalFilter"
          :options="JOURNAL_FILTER_OPTIONS"
        />
        <!-- Une entrée est un lien SSI la base dit que le visiteur courant
             peut ouvrir ce tournoi ou ce match (viewerCanOpen, dérivé par
             le RPC via les helpers de visibilité — la base décide,
             l'interface obéit). Entrée non ouvrable : carte statique, sans
             aucun indicateur (signaler « privé » confirmerait l'existence
             d'un contenu inaccessible). Sur son propre profil, tout est
             ouvrable — aucune régression. -->
        <ul v-if="visibleEntries.length > 0" class="space-y-2.75">
          <li v-for="entry in visibleEntries" :key="entry.key">
            <!-- Pas d'aria-label : le nom accessible dérive du contenu de la
                 carte (rang, tournoi, date, bilan), comme les cartes-liens
                 de l'accueil. -->
            <template v-if="entry.kind === 'tournament'">
              <NuxtLink
                v-if="entry.result.viewerCanOpen"
                :to="`/tournaments/${entry.result.tournamentId}`"
                class="block rounded-(--pk-r-card) transition-opacity hover:opacity-90 active:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                @click="
                rememberJournalOrigin(
                  $event,
                  `/tournaments/${entry.result.tournamentId}`,
                )
              "
              >
                <ProfileJournalEntry
                  :result="entry.result"
                  :teammate-names="teammateNamesFor(entry.result)"
                  interactive
                />
              </NuxtLink>
              <ProfileJournalEntry
                v-else
                :result="entry.result"
                :teammate-names="teammateNamesFor(entry.result)"
              />
            </template>
            <template v-else>
              <NuxtLink
                v-if="entry.freeMatch.viewerCanOpen"
                :to="`/free-matches/${entry.freeMatch.matchId}`"
                class="block rounded-(--pk-r-card) transition-opacity hover:opacity-90 active:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                @click="
                  rememberJournalOrigin(
                    $event,
                    `/free-matches/${entry.freeMatch.matchId}`,
                  )
                "
              >
                <ProfileFreeMatchEntry
                  :free-match="entry.freeMatch"
                  :teammate-names="playerNamesFor(entry.freeMatch.teammates)"
                  :opponent-names="playerNamesFor(entry.freeMatch.opponents)"
                  interactive
                />
              </NuxtLink>
              <ProfileFreeMatchEntry
                v-else
                :free-match="entry.freeMatch"
                :teammate-names="playerNamesFor(entry.freeMatch.teammates)"
                :opponent-names="playerNamesFor(entry.freeMatch.opponents)"
              />
            </template>
          </li>
        </ul>
        <p v-else class="font-sans text-sm text-(--pk-subtle)">
          {{ journalEmptyMessage }}
        </p>
      </section>

      <FriendRemoveConfirmModal
        v-model:open="isRemovalModalOpen"
        :friend-display-name="profile.displayName"
        :is-submitting="isActionPending(userId, 'remove')"
        @confirmed="confirmRemovalFromProfile"
      />
    </div>
  </div>
</template>
