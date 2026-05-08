<script setup lang="ts">
import type { TournamentVisibility } from '../types'

const props = defineProps<{
  open: boolean
  currentVisibility: TournamentVisibility
  tournamentName: string
  isSubmitting?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirmed'): void
}>()

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

// La cible est toujours l'inverse de l'état courant : déduite ici plutôt
// que passée en prop pour éviter les incohérences si l'appelant oublie
// de mettre à jour les deux props ensemble.
const targetVisibility = computed<TournamentVisibility>(() =>
  props.currentVisibility === 'public' ? 'private' : 'public',
)

const title = computed(() =>
  targetVisibility.value === 'public' ? 'Rendre public ?' : 'Rendre privé ?',
)

const confirmLabel = computed(() =>
  targetVisibility.value === 'public' ? 'Rendre public' : 'Rendre privé',
)

function confirm() {
  emit('confirmed')
}

function close() {
  openModel.value = false
}
</script>

<template>
  <UModal
    v-model:open="openModel"
    :title="title"
  >
    <template #body>
      <p class="text-sm text-default">
        <template v-if="targetVisibility === 'public'">
          Le tournoi «&nbsp;<strong>{{ tournamentName }}</strong>&nbsp;»
          sera visible par tous les utilisateurs connectés, ainsi que ses
          équipes et ses scores.
        </template>
        <template v-else>
          Le tournoi «&nbsp;<strong>{{ tournamentName }}</strong>&nbsp;»
          ne sera plus visible des autres utilisateurs.
        </template>
      </p>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <UButton
          color="primary"
          size="lg"
          :loading="isSubmitting"
          block
          @click="confirm"
        >
          {{ confirmLabel }}
        </UButton>
        <UButton
          variant="ghost"
          color="neutral"
          block
          @click="close"
        >
          Annuler
        </UButton>
      </div>
    </template>
  </UModal>
</template>
