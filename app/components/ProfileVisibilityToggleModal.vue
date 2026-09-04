<script setup lang="ts">
import type { ProfileVisibility } from '../types'

// Confirmation de la bascule du réglage de confidentialité (C5 : le
// changement s'accompagne d'une explication de ce qu'il change — qui voit
// quoi). Même moule que TournamentVisibilityToggleModal, à une différence
// près : la CIBLE est passée explicitement par l'appelant — c'est la carte
// tapée — pour que la modale ne puisse jamais contredire le geste qui l'a
// ouverte (le sélecteur en cartes émet aussi au tap sur la carte déjà
// active ; l'appelant filtre ce cas et ne passe que la vraie cible).
const props = defineProps<{
  open: boolean
  targetVisibility: ProfileVisibility
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

const title = computed(() =>
  props.targetVisibility === 'private'
    ? 'Rendre mon profil privé ?'
    : 'Rendre mon profil public ?',
)

const confirmLabel = computed(() =>
  props.targetVisibility === 'private' ? 'Rendre privé' : 'Rendre public',
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
        <template v-if="targetVisibility === 'private'">
          Seuls vos amis verront vos statistiques et votre journal. Les
          autres ne verront que votre pseudo.
        </template>
        <template v-else>
          Tout le monde pourra voir vos statistiques et votre journal, y
          compris les joueurs qui ne sont pas vos amis.
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
