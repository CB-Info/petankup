<script setup lang="ts">
// Confirmation de suppression d'un match libre (créateur seul). Même motif
// que TournamentDeleteConfirmModal : le composant SIGNALE `confirmed`, la
// page supprime. La suppression retire aussi le match des statistiques de
// chaque joueur lié (trigger côté base) — l'utilisateur en est prévenu.
const props = defineProps<{
  open: boolean
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
    title="Supprimer le match"
  >
    <template #body>
      <p class="text-sm text-default">
        Supprimer ce match ? Il disparaîtra des statistiques de tous les
        joueurs liés à un compte.
      </p>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <UButton
          color="error"
          size="lg"
          :loading="isSubmitting"
          block
          @click="confirm"
        >
          Supprimer
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
