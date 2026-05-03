<script setup lang="ts">
import type { Team, TournamentStatus } from '../../types'

const route = useRoute()
const tournamentStore = useTournamentStore()
const { currentTournament, teams } = storeToRefs(tournamentStore)

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
        <p class="py-6 text-center text-sm text-[#5C5A54]">
          À venir (ticket #8b)
        </p>
      </template>

      <template #ranking>
        <p class="py-6 text-center text-sm text-[#5C5A54]">
          À venir (ticket #8c)
        </p>
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
  </div>
</template>
