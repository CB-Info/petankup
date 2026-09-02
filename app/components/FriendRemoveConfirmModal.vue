<script setup lang="ts">
const props = defineProps<{
  open: boolean
  friendDisplayName: string
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
    title="Retirer cet ami"
  >
    <template #body>
      <p class="text-sm text-default">
        Retirer «&nbsp;<strong>{{ friendDisplayName }}</strong>&nbsp;» de vos amis ?
        La relation disparaît des deux côtés. Vous pourrez renvoyer une
        demande plus tard.
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
          Retirer
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
