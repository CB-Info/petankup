<script setup lang="ts">
const props = defineProps<{
  open: boolean
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
    title="Supprimer le tournoi"
  >
    <template #body>
      <p class="text-sm text-(--app-text)">
        Supprimer le tournoi «&nbsp;<strong>{{ tournamentName }}</strong>&nbsp;» ?
        Toutes les équipes et matchs seront perdus.
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
