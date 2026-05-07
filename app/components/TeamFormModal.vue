<script setup lang="ts">
import type { Team } from '../types'
import { teamSchema } from '../utils/teamSchema'

const props = defineProps<{
  open: boolean
  team?: Team | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'saved', team: Team): void
}>()

const tournamentStore = useTournamentStore()

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

const state = reactive<{ name: string, players: string[] }>({
  name: '',
  players: [''],
})

// Le state du formulaire doit refléter la team passée à l'ouverture, et
// repartir à zéro pour une création — sinon on garderait l'état laissé
// par l'ouverture précédente.
function resetStateFromProps() {
  if (props.team) {
    state.name = props.team.name
    state.players = [...props.team.players]
  }
  else {
    state.name = ''
    state.players = ['']
  }
}

watch(
  () => [props.open, props.team] as const,
  ([isOpen]) => {
    if (isOpen) resetStateFromProps()
  },
  { immediate: true },
)

function addPlayerSlot() {
  if (state.players.length < MAX_PLAYERS_PER_TEAM) {
    state.players.push('')
  }
}

function removePlayerAt(playerIndex: number) {
  state.players.splice(playerIndex, 1)
}

// Le schéma Zod valide les joueurs non vides, donc on nettoie avant
// validation : trim + suppression des inputs laissés vides.
function buildSubmissionPayload() {
  const trimmedName = state.name.trim()
  const filteredPlayers = state.players
    .map(playerName => playerName.trim())
    .filter(playerName => playerName.length > 0)
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
      savedTeam = { ...props.team, ...payload }
      await tournamentStore.updateTeam(savedTeam)
    }
    else {
      savedTeam = await tournamentStore.addTeam(payload)
    }
    emit('saved', savedTeam)
    openModel.value = false
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
              v-for="(_, playerIndex) in state.players"
              :key="playerIndex"
              class="flex items-center gap-2"
            >
              <UInput
                v-model="state.players[playerIndex]"
                :placeholder="`Joueur ${playerIndex + 1}`"
                class="flex-1"
              />
              <UButton
                v-if="playerIndex > 0"
                variant="ghost"
                color="neutral"
                icon="i-lucide-x"
                :aria-label="`Retirer le joueur ${playerIndex + 1}`"
                @click="removePlayerAt(playerIndex)"
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
