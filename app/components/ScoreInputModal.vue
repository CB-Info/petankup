<script setup lang="ts">
import type { Match, ScoreValidationResult, Team } from '../types'

const props = defineProps<{
  open: boolean
  match: Match | null
  teamA: Team | null
  teamB: Team | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'saved'): void
}>()

const tournamentStore = useTournamentStore()

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

const modalTitle = computed(() => {
  const nameA = props.teamA?.name ?? '?'
  const nameB = props.teamB?.name ?? '?'
  return `${nameA} vs ${nameB}`
})

// On garde les scores en string pour bien gérer le champ vide (sinon
// type=number force "0" et empêche d'effacer pour retaper).
const scoreAInput = ref('')
const scoreBInput = ref('')
const errorMessage = ref<string | null>(null)
const isSubmitting = ref(false)

function resetFromMatch() {
  errorMessage.value = null
  if (props.match && props.match.status === 'completed') {
    scoreAInput.value = String(props.match.scoreA ?? '')
    scoreBInput.value = String(props.match.scoreB ?? '')
  }
  else {
    scoreAInput.value = ''
    scoreBInput.value = ''
  }
}

watch(
  () => [props.open, props.match?.id] as const,
  ([isOpen]) => {
    if (isOpen) resetFromMatch()
  },
  { immediate: true },
)

function parseScore(rawScore: string): number {
  const parsed = Number.parseInt(rawScore, 10)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

async function onSubmit() {
  if (isSubmitting.value || !props.match) return

  const scoreA = parseScore(scoreAInput.value)
  const scoreB = parseScore(scoreBInput.value)

  if (Number.isNaN(scoreA) || Number.isNaN(scoreB)) {
    errorMessage.value = 'Les scores doivent être des entiers.'
    return
  }

  isSubmitting.value = true
  try {
    // Le store appelle déjà validateScore en interne et nous renvoie
    // { valid, error } : on s'appuie sur ce retour plutôt que de
    // dupliquer la validation côté composant.
    const result: ScoreValidationResult = tournamentStore.submitScore(
      props.match.id,
      scoreA,
      scoreB,
    )
    if (!result.valid) {
      errorMessage.value = result.error ?? 'Score invalide.'
      return
    }
    emit('saved')
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
      <form
        class="space-y-5"
        @submit.prevent="onSubmit"
      >
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <label
              for="score-a-input"
              class="block truncate text-sm font-medium text-horizon-900"
            >
              {{ teamA?.name ?? 'Équipe A' }}
            </label>
            <UInput
              id="score-a-input"
              v-model="scoreAInput"
              type="number"
              inputmode="numeric"
              min="0"
              placeholder="0"
              class="w-full"
              :ui="{ base: 'text-2xl font-semibold tabular-nums text-center h-14' }"
            />
          </div>
          <div class="space-y-2">
            <label
              for="score-b-input"
              class="block truncate text-sm font-medium text-horizon-900"
            >
              {{ teamB?.name ?? 'Équipe B' }}
            </label>
            <UInput
              id="score-b-input"
              v-model="scoreBInput"
              type="number"
              inputmode="numeric"
              min="0"
              placeholder="0"
              class="w-full"
              :ui="{ base: 'text-2xl font-semibold tabular-nums text-center h-14' }"
            />
          </div>
        </div>

        <p
          v-if="errorMessage"
          class="rounded-lg bg-(--app-danger-bg) px-3 py-2 text-sm text-(--app-danger-text)"
          role="alert"
        >
          {{ errorMessage }}
        </p>

        <div class="flex flex-col gap-2 pt-2">
          <UButton
            type="submit"
            color="primary"
            size="lg"
            :loading="isSubmitting"
            block
          >
            Valider le score
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
      </form>
    </template>
  </UModal>
</template>
