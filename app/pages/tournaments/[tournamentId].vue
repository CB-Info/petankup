<script setup lang="ts">
import type { Match, Team, TournamentStatus } from '../../types'

const route = useRoute()
const tournamentStore = useTournamentStore()
const { currentTournament, teams, matches, ranking } = storeToRefs(tournamentStore)

const tournamentId = computed(() => route.params.tournamentId as string)

onMounted(() => {
  tournamentStore.loadTournament(tournamentId.value)
})

// Verrouillage : un tournoi qui a démarré (ou terminé) ne doit plus
// permettre de modifier les équipes — sinon le classement et les
// matchs déjà générés deviendraient incohérents.
const tournamentIsLocked = computed(() => {
  const status = currentTournament.value?.status
  return status === 'in_progress' || status === 'completed'
})

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Brouillon',
  in_progress: 'En cours',
  completed: 'Terminé',
}

type StatusBadgeColor = 'primary' | 'secondary' | 'success'

const STATUS_BADGE_COLORS: Record<TournamentStatus, StatusBadgeColor> = {
  draft: 'secondary',
  in_progress: 'primary',
  completed: 'success',
}

const statusLabel = computed(() =>
  currentTournament.value
    ? STATUS_LABELS[currentTournament.value.status]
    : '',
)

const statusBadgeColor = computed<StatusBadgeColor>(() =>
  currentTournament.value
    ? STATUS_BADGE_COLORS[currentTournament.value.status]
    : 'primary',
)

const tabItems = [
  { label: 'Équipes', slot: 'teams' as const },
  { label: 'Matchs', slot: 'matches' as const },
  { label: 'Classement', slot: 'ranking' as const },
]

const activeTab = ref('0')

const formModalOpen = ref(false)
const editingTeam = ref<Team | null>(null)
const deleteModalOpen = ref(false)
const teamPendingDeletion = ref<Team | null>(null)

function openCreateForm() {
  editingTeam.value = null
  formModalOpen.value = true
}

function openEditForm(team: Team) {
  editingTeam.value = team
  formModalOpen.value = true
}

function askDeleteConfirmation(team: Team) {
  teamPendingDeletion.value = team
  deleteModalOpen.value = true
}

function confirmDelete() {
  if (teamPendingDeletion.value) {
    tournamentStore.deleteTeam(teamPendingDeletion.value.id)
  }
  teamPendingDeletion.value = null
}

const teamsById = computed<Record<string, Team>>(() => {
  return Object.fromEntries(teams.value.map(team => [team.id, team]))
})

function getTeamById(teamId: string): Team | null {
  return teamsById.value[teamId] ?? null
}

type RoundGroup = { round: number, matches: Match[] }

// Les matchs sont stockés à plat avec un champ `round` ; on les regroupe
// pour l'affichage par manche, en triant par numéro de manche croissant.
const matchesByRound = computed<RoundGroup[]>(() => {
  const groupedMatches = new Map<number, Match[]>()
  for (const match of matches.value) {
    const existingMatchesInRound = groupedMatches.get(match.round) ?? []
    existingMatchesInRound.push(match)
    groupedMatches.set(match.round, existingMatchesInRound)
  }
  return [...groupedMatches.entries()]
    .sort(([roundA], [roundB]) => roundA - roundB)
    .map(([round, matchesInRound]) => ({ round, matches: matchesInRound }))
})

const tournamentStatus = computed(() => currentTournament.value?.status)

const tournamentIsCompleted = computed(
  () => tournamentStatus.value === 'completed',
)

const hasEnoughTeamsToStart = computed(() => teams.value.length >= 2)

const isGeneratingMatches = ref(false)

async function startTournament() {
  if (isGeneratingMatches.value) return
  isGeneratingMatches.value = true
  try {
    tournamentStore.generateMatches()
    activeTab.value = String(tabItems.findIndex(tab => tab.slot === 'matches'))
  }
  finally {
    isGeneratingMatches.value = false
  }
}

const scoreModalOpen = ref(false)
const matchBeingScored = ref<Match | null>(null)

function openScoreModal(match: Match) {
  if (tournamentIsCompleted.value) return
  matchBeingScored.value = match
  scoreModalOpen.value = true
}

const matchBeingScoredTeamA = computed(() =>
  matchBeingScored.value ? getTeamById(matchBeingScored.value.teamAId) : null,
)
const matchBeingScoredTeamB = computed(() =>
  matchBeingScored.value ? getTeamById(matchBeingScored.value.teamBId) : null,
)

function teamNameClass(match: Match, teamId: string): string {
  if (match.status !== 'completed') return 'text-horizon-900'
  if (match.winnerId === teamId) return 'font-semibold text-horizon-900'
  return 'text-[#5C5A54]'
}

// Le classement est calculé par le store via computeRanking, qui ne tient
// compte que des matchs `completed`. On joint ici avec les noms d'équipe
// pour l'affichage — séparation propre logique métier / présentation.
type RankingRow = {
  teamId: string
  rank: number
  teamName: string
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDifference: number
}

const rankingRows = computed<RankingRow[]>(() => {
  return ranking.value.map((entry) => {
    const team = getTeamById(entry.teamId)
    return {
      teamId: entry.teamId,
      rank: entry.rank,
      teamName: team?.name ?? '—',
      wins: entry.wins,
      losses: entry.losses,
      pointsFor: entry.pointsFor,
      pointsAgainst: entry.pointsAgainst,
      pointDifference: entry.pointDifference,
    }
  })
})

const completedMatchCount = computed(
  () => matches.value.filter(match => match.status === 'completed').length,
)

const pendingMatchCount = computed(
  () => matches.value.filter(match => match.status === 'pending').length,
)

const hasAnyCompletedMatch = computed(() => completedMatchCount.value > 0)

const allMatchesAreCompleted = computed(
  () => matches.value.length > 0 && pendingMatchCount.value === 0,
)

const canCompleteTournament = computed(
  () =>
    tournamentStatus.value === 'in_progress' && allMatchesAreCompleted.value,
)

function formatPointDifference(pointDifference: number): string {
  if (pointDifference > 0) return `+${pointDifference}`
  return String(pointDifference)
}

function rankingRowBgClass(rank: number): string {
  if (rank === 1) return 'bg-sand-50'
  return ''
}

function rankNumberClass(rank: number): string {
  if (rank <= 3) return 'font-semibold text-horizon-900'
  return 'text-[#8A8880]'
}

const completeModalOpen = ref(false)
const isCompletingTournament = ref(false)

function askCompleteConfirmation() {
  if (!canCompleteTournament.value) return
  completeModalOpen.value = true
}

function confirmCompleteTournament() {
  if (isCompletingTournament.value) return
  isCompletingTournament.value = true
  try {
    tournamentStore.completeTournament()
  }
  finally {
    isCompletingTournament.value = false
    completeModalOpen.value = false
  }
}
</script>

<template>
  <div
    v-if="!currentTournament"
    class="space-y-4 py-12 text-center"
  >
    <h1 class="text-xl font-semibold text-horizon-900">
      Tournoi introuvable
    </h1>
    <UButton
      to="/"
      variant="ghost"
      color="neutral"
      icon="i-lucide-arrow-left"
    >
      Retour à l'accueil
    </UButton>
  </div>

  <div
    v-else
    class="space-y-6"
  >
    <div class="space-y-3">
      <UButton
        to="/"
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
        size="sm"
      >
        Retour
      </UButton>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <h1 class="truncate text-2xl font-semibold text-horizon-900">
            {{ currentTournament.name }}
          </h1>
          <p class="text-sm text-[#5C5A54]">
            {{ formatDate(currentTournament.date) }}
            <template v-if="currentTournament.location">
              · {{ currentTournament.location }}
            </template>
          </p>
        </div>
        <UBadge
          :color="statusBadgeColor"
          variant="soft"
        >
          {{ statusLabel }}
        </UBadge>
      </div>
    </div>

    <UTabs
      v-model="activeTab"
      :items="tabItems"
      class="w-full"
    >
      <template #teams>
        <div class="space-y-4">
          <p
            v-if="tournamentIsLocked"
            class="text-sm text-[#5C5A54]"
          >
            Le tournoi a démarré, les équipes ne peuvent plus être modifiées.
          </p>

          <div
            v-if="teams.length === 0"
            class="space-y-3 rounded-xl border border-dashed border-[#E5E2DB] bg-[#F2F0EB] p-6 text-center"
          >
            <h2 class="text-base font-semibold text-horizon-900">
              Aucune équipe pour l'instant
            </h2>
            <p class="text-sm text-[#5C5A54]">
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

          <div
            v-else
            class="space-y-3"
          >
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
              <li
                v-for="team in teams"
                :key="team.id"
              >
                <UCard>
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 space-y-1">
                      <p class="truncate font-semibold text-horizon-900">
                        {{ team.name }}
                      </p>
                      <p class="truncate text-sm text-[#5C5A54]">
                        {{ team.players.join(' · ') }}
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
            class="rounded-xl border border-dashed border-[#E5E2DB] bg-[#F2F0EB] p-6 text-center"
          >
            <p class="text-sm text-[#5C5A54]">
              Ajoutez au moins 2 équipes pour lancer le tournoi.
            </p>
          </div>

          <div
            v-else-if="tournamentStatus === 'draft'"
            class="space-y-3 rounded-xl border border-dashed border-[#E5E2DB] bg-[#F2F0EB] p-6 text-center"
          >
            <h2 class="text-base font-semibold text-horizon-900">
              Les équipes sont prêtes
            </h2>
            <p class="text-sm text-[#5C5A54]">
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

          <div
            v-else
            class="space-y-6"
          >
            <section
              v-for="roundGroup in matchesByRound"
              :key="roundGroup.round"
              class="space-y-3"
            >
              <h2 class="text-xs font-semibold uppercase tracking-[0.08em] text-[#5C5A54]">
                Manche {{ roundGroup.round }}
              </h2>
              <ul class="space-y-2">
                <li
                  v-for="match in roundGroup.matches"
                  :key="match.id"
                >
                  <UCard :ui="{ body: 'p-4 sm:p-4' }">
                    <div class="flex items-center gap-3">
                      <p
                        class="min-w-0 flex-1 truncate text-sm"
                        :class="teamNameClass(match, match.teamAId)"
                      >
                        {{ getTeamById(match.teamAId)?.name ?? '—' }}
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
                        {{ getTeamById(match.teamBId)?.name ?? '—' }}
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
            class="rounded-xl border border-dashed border-[#E5E2DB] bg-[#F2F0EB] p-6 text-center"
          >
            <p class="text-sm text-[#5C5A54]">
              Le classement apparaîtra après le premier match.
            </p>
          </div>

          <div
            v-else
            class="space-y-4"
          >
            <div class="overflow-hidden rounded-xl border border-[#E5E2DB] bg-white">
              <table class="w-full text-sm">
                <thead class="bg-[#F2F0EB] text-[#5C5A54]">
                  <tr>
                    <th
                      scope="col"
                      class="px-2 py-2 text-left font-medium"
                    >
                      <span class="sr-only">Position</span>#
                    </th>
                    <th
                      scope="col"
                      class="px-2 py-2 text-left font-medium"
                    >
                      Équipe
                    </th>
                    <th
                      scope="col"
                      class="px-2 py-2 text-right font-medium"
                      title="Victoires"
                    >
                      V
                    </th>
                    <th
                      scope="col"
                      class="px-2 py-2 text-right font-medium"
                      title="Défaites"
                    >
                      D
                    </th>
                    <th
                      scope="col"
                      class="px-2 py-2 text-right font-medium"
                      title="Points marqués"
                    >
                      PM
                    </th>
                    <th
                      scope="col"
                      class="px-2 py-2 text-right font-medium"
                      title="Points encaissés"
                    >
                      PE
                    </th>
                    <th
                      scope="col"
                      class="px-2 py-2 pr-3 text-right font-medium"
                      title="Différence de points"
                    >
                      Diff
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in rankingRows"
                    :key="row.teamId"
                    class="border-t border-[#E5E2DB]"
                    :class="rankingRowBgClass(row.rank)"
                  >
                    <td
                      class="px-2 py-3 tabular-nums"
                      :class="rankNumberClass(row.rank)"
                    >
                      {{ row.rank }}
                    </td>
                    <td class="px-2 py-3">
                      <span class="block truncate font-medium text-horizon-900">
                        {{ row.teamName }}
                      </span>
                    </td>
                    <td class="px-2 py-3 text-right tabular-nums">
                      {{ row.wins }}
                    </td>
                    <td class="px-2 py-3 text-right tabular-nums">
                      {{ row.losses }}
                    </td>
                    <td class="px-2 py-3 text-right tabular-nums">
                      {{ row.pointsFor }}
                    </td>
                    <td class="px-2 py-3 text-right tabular-nums">
                      {{ row.pointsAgainst }}
                    </td>
                    <td class="px-2 py-3 pr-3 text-right tabular-nums">
                      {{ formatPointDifference(row.pointDifference) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p class="text-xs text-[#8A8880]">
              V&nbsp;: victoires · D&nbsp;: défaites · PM&nbsp;: points marqués ·
              PE&nbsp;: points encaissés · Diff&nbsp;: différence
            </p>

            <div
              v-if="tournamentStatus === 'in_progress'"
              class="space-y-2"
            >
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
              <p
                v-else
                class="text-center text-sm text-[#5C5A54]"
              >
                {{ pendingMatchCount }}
                {{ pendingMatchCount > 1 ? 'matchs restants à jouer' : 'match restant à jouer' }}
              </p>
            </div>

            <div
              v-else-if="tournamentIsCompleted"
              class="space-y-3 rounded-xl border border-[#E5E2DB] bg-[#F2F0EB] p-4 text-center"
            >
              <p class="text-sm text-[#5C5A54]">
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

    <TeamFormModal
      v-model:open="formModalOpen"
      :team="editingTeam"
    />

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
  </div>
</template>
