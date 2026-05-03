<script setup lang="ts">
import type { Team } from '../types'

const props = defineProps<{
  open: boolean
  team: Team | null
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
  openModel.value = false
}

function close() {
  openModel.value = false
}
</script>

<template>
  <UModal
    v-model:open="openModel"
    title="Supprimer l'équipe"
  >
    <template #body>
      <p class="text-sm text-[#2C2A25]">
        Supprimer l'équipe «&nbsp;<strong>{{ team?.name }}</strong>&nbsp;» ?
        Cette action est irréversible.
      </p>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <UButton
          color="error"
          size="lg"
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
