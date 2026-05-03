<script setup lang="ts">
import type { Match, Team, TournamentStatus } from "../../../types";

const route = useRoute();
const tournamentStore = useTournamentStore();
const { currentTournament, teams, matches, ranking } =
  storeToRefs(tournamentStore);

const tournamentId = computed(() => route.params.tournamentId as string);

// Chargement synchrone dès le setup : évite un flash « Tournoi introuvable »
// au premier rendu si on arrive depuis une URL directe ou un autre tournoi.
tournamentStore.loadTournament(tournamentId.value);

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

function confirmDelete() {
  if (teamPendingDeletion.value) {
    tournamentStore.deleteTeam(teamPendingDeletion.value.id);
  }
  teamPendingDeletion.value = null;
}

const teamsById = computed<Record<string, Team>>(() => {
  return Object.fromEntries(teams.value.map((team) => [team.id, team]));
});

function getTeamById(teamId: string): Team | null {
  return teamsById.value[teamId] ?? null;
}

type RoundGroup = { round: number; matches: Match[] };

// Les matchs sont stockés à plat avec un champ `round` ; on les regroupe
// pour l'affichage par manche, en triant par numéro de manche croissant.
const matchesByRound = computed<RoundGroup[]>(() => {
  const groupedMatches = new Map<number, Match[]>();
  for (const match of matches.value) {
    const existingMatchesInRound = groupedMatches.get(match.round) ?? [];
    existingMatchesInRound.push(match);
    groupedMatches.set(match.round, existingMatchesInRound);
  }
  return [...groupedMatches.entries()]
    .sort(([roundA], [roundB]) => roundA - roundB)
    .map(([round, matchesInRound]) => ({ round, matches: matchesInRound }));
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
    tournamentStore.generateMatches();
    activeTab.value = String(
      tabItems.findIndex((tab) => tab.slot === "matches"),
    );
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
  if (match.status !== "completed") return "text-horizon-900";
  if (match.winnerId === teamId) return "font-semibold text-horizon-900";
  return "text-(--app-text-subtle)";
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

function confirmCompleteTournament() {
  if (isCompletingTournament.value) return;
  isCompletingTournament.value = true;
  try {
    tournamentStore.completeTournament();
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
    tournamentStore.deleteTournament(tournamentId.value);
    tournamentDeleteModalOpen.value = false;
    await navigateTo("/");
  } finally {
    isDeletingTournament.value = false;
  }
}

useHead(() => ({
  title: currentTournament.value
    ? `${currentTournament.value.name} — Pétankup`
    : "Tournoi — Pétankup",
}));
</script>

<template>
  <div v-if="!currentTournament" class="space-y-4 py-12 text-center">
    <h1 class="text-xl font-semibold text-horizon-900">Tournoi introuvable</h1>
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
        <UButton
          v-if="tournamentCanBeDeleted"
          variant="ghost"
          color="neutral"
          icon="i-lucide-trash-2"
          size="sm"
          aria-label="Supprimer le tournoi"
          @click="askTournamentDeleteConfirmation"
        />
      </div>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <h1 class="truncate text-2xl font-semibold text-horizon-900">
            {{ currentTournament.name }}
          </h1>
          <p class="text-sm text-(--app-text-subtle)">
            {{ formatDate(currentTournament.date) }}
            <template v-if="currentTournament.location">
              · {{ currentTournament.location }}
            </template>
          </p>
        </div>
        <UBadge :color="statusBadgeColor" variant="soft">
          {{ statusLabel }}
        </UBadge>
      </div>
    </div>

    <UTabs v-model="activeTab" :items="tabItems" class="w-full">
      <template #teams>
        <div class="space-y-4">
          <p v-if="tournamentIsLocked" class="text-sm text-(--app-text-subtle)">
            Le tournoi a démarré, les équipes ne peuvent plus être modifiées.
          </p>

          <div
            v-if="teams.length === 0"
            class="space-y-3 rounded-xl border border-dashed border-(--app-border) bg-(--app-surface) p-6 text-center"
          >
            <h2 class="text-base font-semibold text-horizon-900">
              Aucune équipe pour l'instant
            </h2>
            <p class="text-sm text-(--app-text-subtle)">
              Ajoutez les équipes participantes au tournoi
            </p>
            <UButton
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
                      <p class="truncate font-semibold text-horizon-900">
                        {{ team.name }}
                      </p>
                      <p class="truncate text-sm text-(--app-text-subtle)">
                        {{ team.players.join(" · ") }}
                      </p>
                    </div>
                    <div class="flex shrink-0 gap-1">
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
          <div
            v-if="tournamentStatus === 'draft' && !hasEnoughTeamsToStart"
            class="rounded-xl border border-dashed border-(--app-border) bg-(--app-surface) p-6 text-center"
          >
            <p class="text-sm text-(--app-text-subtle)">
              Ajoutez au moins 2 équipes pour lancer le tournoi.
            </p>
          </div>

          <div
            v-else-if="tournamentStatus === 'draft'"
            class="space-y-3 rounded-xl border border-dashed border-(--app-border) bg-(--app-surface) p-6 text-center"
          >
            <h2 class="text-base font-semibold text-horizon-900">
              Les équipes sont prêtes
            </h2>
            <p class="text-sm text-(--app-text-subtle)">
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

          <div v-else class="space-y-6">
            <section
              v-for="roundGroup in matchesByRound"
              :key="roundGroup.round"
              class="space-y-3"
            >
              <h2
                class="text-xs font-semibold uppercase tracking-[0.08em] text-(--app-text-subtle)"
              >
                Manche {{ roundGroup.round }}
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
                        <button
                          v-if="match.status === 'completed'"
                          type="button"
                          class="rounded-md px-2 py-1 text-base font-semibold tabular-nums text-horizon-900 hover:bg-horizon-50 disabled:cursor-not-allowed disabled:opacity-60"
                          :disabled="tournamentIsCompleted"
                          @click="openScoreModal(match)"
                        >
                          {{ match.scoreA }} - {{ match.scoreB }}
                        </button>
                        <UButton
                          v-else
                          variant="soft"
                          color="primary"
                          size="sm"
                          :disabled="tournamentIsCompleted"
                          @click="openScoreModal(match)"
                        >
                          Saisir le score
                        </UButton>
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
            class="rounded-xl border border-dashed border-(--app-border) bg-(--app-surface) p-6 text-center"
          >
            <p class="text-sm text-(--app-text-subtle)">
              Le classement apparaîtra après le premier match.
            </p>
          </div>

          <div v-else class="space-y-4">
            <RankingTable :ranking="ranking" :teams="teams" />

            <div v-if="tournamentStatus === 'in_progress'" class="space-y-2">
              <UButton
                v-if="canCompleteTournament"
                icon="i-lucide-trophy"
                color="primary"
                size="lg"
                block
                @click="askCompleteConfirmation"
              >
                Terminer le tournoi
              </UButton>
              <p v-else class="text-center text-sm text-(--app-text-subtle)">
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
              class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 text-center"
            >
              <p class="text-sm text-(--app-text-subtle)">
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
  </div>
</template>
