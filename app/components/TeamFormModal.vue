<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
import type { Team, TeamPlayer } from '../types'
import { teamSchema } from '../utils/teamSchema'
import { computeNextTeamNameDefault } from '../utils/team-defaults'
import { computeAvailablePlayerOptions } from '../utils/team-player-options'

const props = defineProps<{
  open: boolean
  team?: Team | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'saved', team: Team): void
}>()

const tournamentStore = useTournamentStore()
const { teams, currentTournament, currentTournamentMembers, profileById }
  = storeToRefs(tournamentStore)
const { showError } = useErrorToast()

const MAX_PLAYERS_PER_TEAM = 3

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

const isEditMode = computed(() => props.team != null)

const modalTitle = computed(() =>
  isEditMode.value ? "Modifier l'équipe" : 'Ajouter une équipe',
)

const submitLabel = computed(() => (isEditMode.value ? 'Modifier' : 'Ajouter'))

// Un slot = un joueur : lié à un compte (userId non-null) ou libre (userId
// null, nom saisi). PlayerSlotInput maintient ce couple via deux v-model.
type PlayerSlot = { userId: string | null, displayName: string }

const state = reactive<{ name: string, players: PlayerSlot[] }>({
  name: '',
  players: [{ userId: null, displayName: '' }],
})

function playerToSlot(player: TeamPlayer): PlayerSlot {
  return { userId: player.userId, displayName: player.displayNameSnapshot }
}

// Le state du formulaire reflète la team passée à l'ouverture, et repart à
// zéro pour une création (nom prérempli "Équipe N", cf. F.2). Recalculé à
// chaque ouverture via le watch ci-dessous.
function resetStateFromProps() {
  if (props.team) {
    state.name = props.team.name
    state.players = props.team.players.map(playerToSlot)
  }
  else {
    state.name = computeNextTeamNameDefault(teams.value.map(team => team.name))
    state.players = [{ userId: null, displayName: '' }]
  }
}

// Hydrate les pseudos de l'owner + des invités à l'ouverture, pour que le
// sélecteur affiche les pseudos live. Idempotent + fire-and-forget.
function hydrateMemberProfiles() {
  const tournament = currentTournament.value
  if (tournament === null) return
  const ids = [
    tournament.ownerId,
    ...currentTournamentMembers.value.map(member => member.userId),
  ]
  void tournamentStore.loadProfilesByIds(ids)
}

watch(
  () => [props.open, props.team] as const,
  ([isOpen]) => {
    if (isOpen) {
      resetStateFromProps()
      hydrateMemberProfiles()
    }
  },
  { immediate: true },
)

// Options de base du sélecteur (owner + invités, avec grisage des engagements
// dans d'autres équipes). Recalculées quand membres / profils / équipes changent.
const baseOptions = computed(() => {
  const tournament = currentTournament.value
  if (tournament === null) return []
  return computeAvailablePlayerOptions({
    ownerId: tournament.ownerId,
    members: currentTournamentMembers.value,
    profileById: profileById.value,
    teams: teams.value,
    editingTeamId: props.team?.id ?? null,
  })
})

// Pour un slot donné, on grise en plus les invités déjà choisis dans les
// AUTRES slots de l'équipe en cours (un même invité ne peut pas occuper deux
// slots — déjà bloqué côté Zod + DB, l'UI le reflète).
function optionsForSlot(slotIndex: number) {
  const userIdsInOtherSlots = new Set(
    state.players
      .filter((_, index) => index !== slotIndex)
      .map(slot => slot.userId)
      .filter((userId): userId is string => userId !== null),
  )
  return baseOptions.value.map(option => ({
    ...option,
    disabled: option.disabled || userIdsInOtherSlots.has(option.userId),
    disabledReason: userIdsInOtherSlots.has(option.userId)
      ? 'déjà sélectionné'
      : option.disabledReason,
  }))
}

function addPlayerSlot() {
  if (state.players.length < MAX_PLAYERS_PER_TEAM) {
    state.players.push({ userId: null, displayName: '' })
  }
}

function removePlayerAt(slotIndex: number) {
  state.players.splice(slotIndex, 1)
}

// Le schéma Zod valide les joueurs non vides, donc on nettoie avant validation :
// trim du displayName + suppression des slots laissés vides.
function buildSubmissionPayload() {
  const trimmedName = state.name.trim()
  const filteredPlayers = state.players
    .map(slot => ({ userId: slot.userId, displayName: slot.displayName.trim() }))
    .filter(slot => slot.displayName.length > 0)
  return { name: trimmedName, players: filteredPlayers }
}

const trimmedFormState = computed(() => buildSubmissionPayload())

const isSubmitting = ref(false)

async function onSubmit() {
  if (isSubmitting.value) return
  isSubmitting.value = true
  try {
    const payload = buildSubmissionPayload()
    let savedTeam: Team
    if (props.team) {
      savedTeam = await tournamentStore.updateTeam(
        props.team.id,
        payload.name,
        payload.players,
      )
    }
    else {
      savedTeam = await tournamentStore.addTeam({
        name: payload.name,
        players: payload.players,
      })
    }
    emit('saved', savedTeam)
    openModel.value = false
  }
  catch (error) {
    showError(error)
  }
  finally {
    isSubmitting.value = false
  }
}

function close() {
  openModel.value = false
}
</script>

<template>
  <UModal
    v-model:open="openModel"
    :title="modalTitle"
  >
    <template #body>
      <UForm
        :schema="teamSchema"
        :state="trimmedFormState"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Nom de l'équipe"
          name="name"
          required
        >
          <UInput
            v-model="state.name"
            placeholder="Ex : Les Invincibles"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Joueurs"
          name="players"
          required
        >
          <div class="space-y-2">
            <div
              v-for="(slot, slotIndex) in state.players"
              :key="slotIndex"
              class="flex items-center gap-2"
            >
              <PlayerSlotInput
                v-model:user-id="slot.userId"
                v-model:display-name="slot.displayName"
                :options="optionsForSlot(slotIndex)"
                :placeholder="`Joueur ${slotIndex + 1}`"
                class="flex-1"
              />
              <UButton
                v-if="slotIndex > 0"
                variant="ghost"
                color="neutral"
                icon="i-lucide-x"
                :aria-label="`Retirer le joueur ${slotIndex + 1}`"
                @click="removePlayerAt(slotIndex)"
              />
            </div>
            <UButton
              v-if="state.players.length < MAX_PLAYERS_PER_TEAM"
              variant="ghost"
              color="neutral"
              icon="i-lucide-plus"
              @click="addPlayerSlot"
            >
              Ajouter un joueur
            </UButton>
          </div>
        </UFormField>

        <div class="flex flex-col gap-2 pt-2">
          <UButton
            type="submit"
            color="primary"
            size="lg"
            :loading="isSubmitting"
            block
          >
            {{ submitLabel }}
          </UButton>
          <UButton
            type="button"
            variant="ghost"
            color="neutral"
            block
            @click="close"
          >
            Annuler
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
