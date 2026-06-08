<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
import type { Match, Team, TournamentStatus } from "../../../types";
import { getPlayerDisplayName } from "../../../utils/team-player-display";

const route = useRoute();
const tournamentStore = useTournamentStore();
const {
  currentTournament,
  teams,
  matches,
  ranking,
  isOwnerOfCurrentTournament,
  profileById,
} = storeToRefs(tournamentStore);
const { showError } = useErrorToast();

// Alias local lisible : tout l'ownership conditionne des actions admin
// dans le template, on ne le manipule jamais ailleurs.
const isOwner = isOwnerOfCurrentTournament;

// Hydratation best-effort du profil de l'organisateur, uniquement quand
// je ne suis pas l'owner (inutile d'afficher "Organisé par moi"). Le
// `void` est fire-and-forget ; loadProfilesByIds ne throw jamais.
watch(
  currentTournament,
  (tournament) => {
    if (tournament && !isOwner.value) {
      void tournamentStore.loadProfilesByIds([tournament.ownerId]);
    }
  },
  { immediate: true },
);

// Nom de l'organisateur si son profil est résolu, sinon null (la ligne
// "Organisé par" est alors omise — pas de placeholder).
function organizerName(ownerId: string): string | null {
  return profileById.value[ownerId]?.displayName ?? null;
}

const tournamentId = computed(() => route.params.tournamentId as string);

const isLoadingDetail = ref(true);

// Token local pour invalider le flip de isLoadingDetail si une nouvelle
// requête a démarré entre-temps. Combiné avec le token store
// (loadTournament), on a une défense en profondeur : le store ignore
// l'écriture des données de A, la page ignore le flip de A.
let loadDetailRequestId = 0;

// watch(tournamentId, immediate: true) : couvre le mount initial ET
// la réutilisation de composant Nuxt sur changement de paramètre de
// route (sans cela, onMounted ne refire pas et l'état reste bloqué).
watch(
  tournamentId,
  async (id) => {
    const requestId = ++loadDetailRequestId;
    isLoadingDetail.value = true;
    try {
      await tournamentStore.loadTournament(id);
      // Fire-and-forget : les membres alimentent le sélecteur de joueurs du
      // TeamFormModal (et la modal "Gérer les invités"). loadTournamentMembers
      // a son propre token de course, OK de l'appeler en parallèle sans await.
      void tournamentStore.loadTournamentMembers(id);
    } catch (error) {
      if (requestId === loadDetailRequestId) showError(error);
    } finally {
      if (requestId === loadDetailRequestId) {
        isLoadingDetail.value = false;
      }
    }
  },
  { immediate: true },
);

// Verrouillage : un tournoi qui a démarré (ou terminé) ne doit plus
// permettre de modifier les équipes — sinon le classement et les
// matchs déjà générés deviendraient incohérents.
const tournamentIsLocked = computed(() => {
  const status = currentTournament.value?.status;
  return status === "in_progress" || status === "completed";
});

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: "Brouillon",
  in_progress: "En cours",
  completed: "Terminé",
};

type StatusBadgeColor = "primary" | "secondary" | "success";

const STATUS_BADGE_COLORS: Record<TournamentStatus, StatusBadgeColor> = {
  draft: "secondary",
  in_progress: "primary",
  completed: "success",
};

const statusLabel = computed(() =>
  currentTournament.value ? STATUS_LABELS[currentTournament.value.status] : "",
);

const statusBadgeColor = computed<StatusBadgeColor>(() =>
  currentTournament.value
    ? STATUS_BADGE_COLORS[currentTournament.value.status]
    : "primary",
);

const tabItems = [
  { label: "Équipes", slot: "teams" as const },
  { label: "Matchs", slot: "matches" as const },
  { label: "Classement", slot: "ranking" as const },
];

const activeTab = ref("0");

const formModalOpen = ref(false);
const editingTeam = ref<Team | null>(null);
const deleteModalOpen = ref(false);
const teamPendingDeletion = ref<Team | null>(null);

function openCreateForm() {
  editingTeam.value = null;
  formModalOpen.value = true;
}

function openEditForm(team: Team) {
  editingTeam.value = team;
  formModalOpen.value = true;
}

function askDeleteConfirmation(team: Team) {
  teamPendingDeletion.value = team;
  deleteModalOpen.value = true;
}

async function confirmDelete() {
  if (teamPendingDeletion.value) {
    try {
      await tournamentStore.deleteTeam(teamPendingDeletion.value.id);
    } catch (error) {
      showError(error);
    }
  }
  teamPendingDeletion.value = null;
}

const teamsById = computed<Record<string, Team>>(() => {
  return Object.fromEntries(teams.value.map((team) => [team.id, team]));
});

function getTeamById(teamId: string): Team | null {
  return teamsById.value[teamId] ?? null;
}

// Joueurs d'une équipe en texte " · " : pseudo live (via profileById) pour
// les joueurs liés hydratés, snapshot sinon. Les profils du tournoi sont
// déjà hydratés sur cette page (ownership + membres chargés).
function formatTeamPlayers(team: Team): string {
  return team.players
    .map((player) => getPlayerDisplayName(player, profileById.value))
    .join(" · ");
}

type RoundGroup = { roundNumber: number; matches: Match[] };

// Les matchs sont stockés à plat avec un champ `roundNumber` ; on les regroupe
// pour l'affichage par manche, en triant par numéro de manche croissant.
const matchesByRound = computed<RoundGroup[]>(() => {
  const groupedMatches = new Map<number, Match[]>();
  for (const match of matches.value) {
    const existingMatchesInRound = groupedMatches.get(match.roundNumber) ?? [];
    existingMatchesInRound.push(match);
    groupedMatches.set(match.roundNumber, existingMatchesInRound);
  }
  return [...groupedMatches.entries()]
    .sort(([roundNumberA], [roundNumberB]) => roundNumberA - roundNumberB)
    .map(([roundNumber, matchesInRound]) => ({ roundNumber, matches: matchesInRound }));
});

const tournamentStatus = computed(() => currentTournament.value?.status);

const tournamentIsCompleted = computed(
  () => tournamentStatus.value === "completed",
);

const hasEnoughTeamsToStart = computed(() => teams.value.length >= 2);

const isGeneratingMatches = ref(false);

async function startTournament() {
  if (isGeneratingMatches.value) return;
  isGeneratingMatches.value = true;
  try {
    await tournamentStore.generateMatches();
    activeTab.value = String(
      tabItems.findIndex((tab) => tab.slot === "matches"),
    );
  } catch (error) {
    showError(error);
  } finally {
    isGeneratingMatches.value = false;
  }
}

const scoreModalOpen = ref(false);
const matchBeingScored = ref<Match | null>(null);

function openScoreModal(match: Match) {
  if (tournamentIsCompleted.value) return;
  matchBeingScored.value = match;
  scoreModalOpen.value = true;
}

const matchBeingScoredTeamA = computed(() =>
  matchBeingScored.value ? getTeamById(matchBeingScored.value.teamAId) : null,
);
const matchBeingScoredTeamB = computed(() =>
  matchBeingScored.value ? getTeamById(matchBeingScored.value.teamBId) : null,
);

function teamNameClass(match: Match, teamId: string): string {
  if (match.status !== "completed") return "text-primary-900";
  if (match.winnerId === teamId) return "font-semibold text-primary-900";
  return "text-toned";
}

// Le classement est calculé par le store via computeRanking et affiché
// par le composant <RankingTable> — pas de logique métier dans la page.

const pendingMatchCount = computed(
  () => matches.value.filter((match) => match.status === "pending").length,
);

const hasAnyCompletedMatch = computed(() =>
  matches.value.some((match) => match.status === "completed"),
);

const allMatchesAreCompleted = computed(
  () => matches.value.length > 0 && pendingMatchCount.value === 0,
);

const canCompleteTournament = computed(
  () =>
    tournamentStatus.value === "in_progress" && allMatchesAreCompleted.value,
);

const completeModalOpen = ref(false);
const isCompletingTournament = ref(false);

function askCompleteConfirmation() {
  if (!canCompleteTournament.value) return;
  completeModalOpen.value = true;
}

async function confirmCompleteTournament() {
  if (isCompletingTournament.value) return;
  isCompletingTournament.value = true;
  try {
    await tournamentStore.completeTournament();
  } catch (error) {
    showError(error);
  } finally {
    isCompletingTournament.value = false;
    completeModalOpen.value = false;
  }
}

// La suppression n'est possible qu'en `draft` : un tournoi `in_progress`
// ou `completed` a une valeur historique qu'on ne veut pas perdre par
// erreur. La cascade côté repository gère teams + matches.
const tournamentCanBeDeleted = computed(
  () => tournamentStatus.value === "draft",
);

const tournamentDeleteModalOpen = ref(false);
const isDeletingTournament = ref(false);

function askTournamentDeleteConfirmation() {
  if (!tournamentCanBeDeleted.value) return;
  tournamentDeleteModalOpen.value = true;
}

async function confirmTournamentDelete() {
  if (isDeletingTournament.value) return;
  isDeletingTournament.value = true;
  try {
    await tournamentStore.deleteTournament(tournamentId.value);
    tournamentDeleteModalOpen.value = false;
    await navigateTo("/");
  } catch (error) {
    showError(error);
  } finally {
    isDeletingTournament.value = false;
  }
}

const visibilityToggleModalOpen = ref(false);
const isTogglingVisibility = ref(false);

function askVisibilityToggle() {
  if (!isOwner.value) return;
  visibilityToggleModalOpen.value = true;
}

const membersModalOpen = ref(false);

// Source de vérité unique du droit de gestion des invités. Deux
// conditions combinées, consommées par : (1) le v-if du bouton dans
// la barre d'actions, (2) la garde de openMembersModal, (3) le
// watcher d'auto-fermeture ci-dessous. Centraliser ici évite tout
// drift entre sites de consommation. L'invitation est autorisée sur
// les tournois privés ET publics (Phase F.1) : l'invité bascule en
// "Partagés avec moi" via la partition home, sans badge dédié.
const canManageMembers = computed(() => {
  if (!isOwner.value) return false;
  if (tournamentIsCompleted.value) return false;
  return true;
});

function openMembersModal() {
  if (!canManageMembers.value) return;
  membersModalOpen.value = true;
}

// Auto-fermeture si la permission disparaît pendant que le modal est
// ouvert : passage en 'completed', bascule public, perte d'ownership.
// Sans ce watch, l'utilisateur pourrait continuer à inviter/désinviter
// sur un tournoi qui ne le permet plus, le temps qu'il ferme à la
// main. Couvre notamment le cas multi-onglets.
watch(canManageMembers, (canManage) => {
  if (!canManage) {
    membersModalOpen.value = false;
  }
});

async function confirmVisibilityToggle() {
  if (currentTournament.value === null) return;
  if (isTogglingVisibility.value) return;
  isTogglingVisibility.value = true;
  try {
    const targetVisibility =
      currentTournament.value.visibility === "public" ? "private" : "public";
    await tournamentStore.setTournamentVisibility(
      currentTournament.value.id,
      targetVisibility,
    );
    visibilityToggleModalOpen.value = false;
  } catch (error) {
    showError(error);
  } finally {
    isTogglingVisibility.value = false;
  }
}

useHead(() => ({
  title: currentTournament.value
    ? `${currentTournament.value.name} — Pétankup`
    : "Tournoi — Pétankup",
}));
</script>

<template>
  <div v-if="isLoadingDetail" class="py-12 text-center">
    <p class="text-toned">Chargement du tournoi…</p>
  </div>

  <!-- Garde finale : on n'affiche le contenu que si le tournoi en
       mémoire correspond à l'id de route. La forme inline (vs un
       computed booléen) permet à volar de narrower currentTournament
       à non-null dans le v-else. -->
  <div
    v-else-if="!currentTournament || currentTournament.id !== tournamentId"
    class="space-y-4 py-12 text-center"
  >
    <h1 class="text-xl font-semibold text-primary-900">Tournoi introuvable</h1>
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left">
      Retour à l'accueil
    </UButton>
  </div>

  <div v-else class="space-y-6">
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <UButton
          to="/"
          variant="ghost"
          color="neutral"
          icon="i-lucide-arrow-left"
          size="sm"
        >
          Retour
        </UButton>
        <div class="flex items-center gap-1">
          <UButton
            v-if="isOwner"
            variant="ghost"
            color="neutral"
            :icon="
              currentTournament.visibility === 'public'
                ? 'i-lucide-lock'
                : 'i-lucide-globe'
            "
            size="sm"
            :aria-label="
              currentTournament.visibility === 'public'
                ? 'Rendre privé'
                : 'Rendre public'
            "
            @click="askVisibilityToggle"
          />
          <UButton
            v-if="canManageMembers"
            variant="ghost"
            color="neutral"
            icon="i-lucide-users"
            size="sm"
            aria-label="Gérer les invités"
            @click="openMembersModal"
          />
          <UButton
            v-if="tournamentCanBeDeleted && isOwner"
            variant="ghost"
            color="neutral"
            icon="i-lucide-trash-2"
            size="sm"
            aria-label="Supprimer le tournoi"
            @click="askTournamentDeleteConfirmation"
          />
        </div>
      </div>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <h1 class="truncate text-2xl font-semibold text-primary-900">
            {{ currentTournament.name }}
          </h1>
          <p class="text-sm text-toned">
            {{ formatDate(currentTournament.date) }}
            <template v-if="currentTournament.location">
              · {{ currentTournament.location }}
            </template>
          </p>
          <p
            v-if="!isOwner && organizerName(currentTournament.ownerId)"
            class="truncate text-sm text-toned"
          >
            Organisé par {{ organizerName(currentTournament.ownerId) }}
          </p>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1">
          <UBadge :color="statusBadgeColor" variant="soft">
            {{ statusLabel }}
          </UBadge>
          <VisibilityBadge :visibility="currentTournament.visibility" />
        </div>
      </div>
    </div>

    <UTabs v-model="activeTab" :items="tabItems" class="w-full">
      <template #teams>
        <div class="space-y-4">
          <p v-if="tournamentIsLocked" class="text-sm text-toned">
            Le tournoi a démarré, les équipes ne peuvent plus être modifiées.
          </p>

          <div
            v-if="teams.length === 0"
            class="space-y-3 rounded-xl border border-dashed border-default bg-elevated p-6 text-center"
          >
            <h2 class="text-base font-semibold text-primary-900">
              Aucune équipe pour l'instant
            </h2>
            <p class="text-sm text-toned">
              Ajoutez les équipes participantes au tournoi
            </p>
            <UButton
              v-if="isOwner"
              icon="i-lucide-plus"
              color="primary"
              size="lg"
              :disabled="tournamentIsLocked"
              block
              @click="openCreateForm"
            >
              Ajouter une équipe
            </UButton>
          </div>

          <div v-else class="space-y-3">
            <UButton
              v-if="isOwner"
              icon="i-lucide-plus"
              color="primary"
              size="lg"
              :disabled="tournamentIsLocked"
              block
              @click="openCreateForm"
            >
              Ajouter une équipe
            </UButton>

            <ul class="space-y-3">
              <li v-for="team in teams" :key="team.id">
                <UCard>
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 space-y-1">
                      <p class="truncate font-semibold text-primary-900">
                        {{ team.name }}
                      </p>
                      <p class="truncate text-sm text-toned">
                        {{ formatTeamPlayers(team) }}
                      </p>
                    </div>
                    <div v-if="isOwner" class="flex shrink-0 gap-1">
                      <UButton
                        variant="ghost"
                        color="neutral"
                        icon="i-lucide-pencil"
                        :disabled="tournamentIsLocked"
                        aria-label="Modifier l'équipe"
                        @click="openEditForm(team)"
                      />
                      <UButton
                        variant="ghost"
                        color="neutral"
                        icon="i-lucide-trash-2"
                        :disabled="tournamentIsLocked"
                        aria-label="Supprimer l'équipe"
                        @click="askDeleteConfirmation(team)"
                      />
                    </div>
                  </div>
                </UCard>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <template #matches>
        <div class="space-y-4">
          <template v-if="tournamentStatus === 'draft' && isOwner">
            <div
              v-if="!hasEnoughTeamsToStart"
              class="rounded-xl border border-dashed border-default bg-elevated p-6 text-center"
            >
              <p class="text-sm text-toned">
                Ajoutez au moins 2 équipes pour lancer le tournoi.
              </p>
            </div>

            <div
              v-else
              class="space-y-3 rounded-xl border border-dashed border-default bg-elevated p-6 text-center"
            >
              <h2 class="text-base font-semibold text-primary-900">
                Les équipes sont prêtes
              </h2>
              <p class="text-sm text-toned">
                Lancez le tournoi pour générer le calendrier des matchs.
              </p>
              <UButton
                icon="i-lucide-play"
                color="primary"
                size="lg"
                :loading="isGeneratingMatches"
                block
                @click="startTournament"
              >
                Lancer le tournoi
              </UButton>
            </div>
          </template>

          <div
            v-else-if="tournamentStatus === 'draft'"
            class="rounded-xl border border-dashed border-default bg-elevated p-6 text-center"
          >
            <p class="text-sm text-toned">
              Le tournoi n'a pas encore démarré.
            </p>
          </div>

          <div v-else class="space-y-6">
            <section
              v-for="roundGroup in matchesByRound"
              :key="roundGroup.roundNumber"
              class="space-y-3"
            >
              <h2
                class="text-xs font-semibold uppercase tracking-[0.08em] text-toned"
              >
                Manche {{ roundGroup.roundNumber }}
              </h2>
              <ul class="space-y-2">
                <li v-for="match in roundGroup.matches" :key="match.id">
                  <UCard :ui="{ body: 'p-4 sm:p-4' }">
                    <div class="flex items-center gap-3">
                      <p
                        class="min-w-0 flex-1 truncate text-sm"
                        :class="teamNameClass(match, match.teamAId)"
                      >
                        {{ getTeamById(match.teamAId)?.name ?? "—" }}
                      </p>

                      <div class="shrink-0">
                        <template v-if="match.status === 'completed'">
                          <button
                            v-if="isOwner"
                            type="button"
                            class="rounded-md px-2 py-1 text-base font-semibold tabular-nums text-primary-900 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
                            :disabled="tournamentIsCompleted"
                            @click="openScoreModal(match)"
                          >
                            {{ match.scoreA }} - {{ match.scoreB }}
                          </button>
                          <span
                            v-else
                            class="px-2 py-1 text-base font-semibold tabular-nums text-primary-900"
                          >
                            {{ match.scoreA }} - {{ match.scoreB }}
                          </span>
                        </template>
                        <template v-else>
                          <UButton
                            v-if="isOwner"
                            variant="soft"
                            color="primary"
                            size="sm"
                            :disabled="tournamentIsCompleted"
                            @click="openScoreModal(match)"
                          >
                            Saisir le score
                          </UButton>
                          <p v-else class="text-sm text-toned">À jouer</p>
                        </template>
                      </div>

                      <p
                        class="min-w-0 flex-1 truncate text-right text-sm"
                        :class="teamNameClass(match, match.teamBId)"
                      >
                        {{ getTeamById(match.teamBId)?.name ?? "—" }}
                      </p>
                    </div>
                  </UCard>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </template>

      <template #ranking>
        <div class="space-y-4">
          <div
            v-if="!hasAnyCompletedMatch"
            class="rounded-xl border border-dashed border-default bg-elevated p-6 text-center"
          >
            <p class="text-sm text-toned">
              Le classement apparaîtra après le premier match.
            </p>
          </div>

          <div v-else class="space-y-4">
            <RankingTable :ranking="ranking" :teams="teams" />

            <div v-if="tournamentStatus === 'in_progress'" class="space-y-2">
              <UButton
                v-if="canCompleteTournament && isOwner"
                icon="i-lucide-trophy"
                color="primary"
                size="lg"
                block
                @click="askCompleteConfirmation"
              >
                Terminer le tournoi
              </UButton>
              <p
                v-else-if="pendingMatchCount > 0"
                class="text-center text-sm text-toned"
              >
                {{ pendingMatchCount }}
                {{
                  pendingMatchCount > 1
                    ? "matchs restants à jouer"
                    : "match restant à jouer"
                }}
              </p>
            </div>

            <div
              v-else-if="tournamentIsCompleted"
              class="space-y-3 rounded-xl border border-default bg-elevated p-4 text-center"
            >
              <p class="text-sm text-toned">
                Tournoi terminé le {{ formatDate(currentTournament.updatedAt) }}
              </p>
              <UButton
                :to="`/tournaments/${tournamentId}/results`"
                variant="soft"
                color="primary"
                icon="i-lucide-trophy"
                block
              >
                Voir les résultats
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UTabs>

    <TeamFormModal v-model:open="formModalOpen" :team="editingTeam" />

    <TeamDeleteConfirmModal
      v-model:open="deleteModalOpen"
      :team="teamPendingDeletion"
      @confirmed="confirmDelete"
    />

    <ScoreInputModal
      v-model:open="scoreModalOpen"
      :match="matchBeingScored"
      :team-a="matchBeingScoredTeamA"
      :team-b="matchBeingScoredTeamB"
    />

    <TournamentCompleteConfirmModal
      v-model:open="completeModalOpen"
      :tournament-name="currentTournament.name"
      :is-submitting="isCompletingTournament"
      @confirmed="confirmCompleteTournament"
    />

    <TournamentDeleteConfirmModal
      v-model:open="tournamentDeleteModalOpen"
      :tournament-name="currentTournament.name"
      :is-submitting="isDeletingTournament"
      @confirmed="confirmTournamentDelete"
    />

    <TournamentVisibilityToggleModal
      v-model:open="visibilityToggleModalOpen"
      :current-visibility="currentTournament.visibility"
      :tournament-name="currentTournament.name"
      :is-submitting="isTogglingVisibility"
      @confirmed="confirmVisibilityToggle"
    />

    <TournamentMembersModal
      v-model:open="membersModalOpen"
      :tournament-id="tournamentId"
      :tournament-name="currentTournament.name"
    />
  </div>
</template>
