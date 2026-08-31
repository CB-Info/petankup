<script setup lang="ts">
// Sélecteur d'un joueur d'équipe : un invité du tournoi (option du dropdown,
// pseudo live) OU un nom libre saisi au clavier. Encapsule la complexité du
// combobox Nuxt UI (USelectMenu searchable + create-item) pour que le parent
// (TeamFormModal) ne manipule qu'un couple { userId, displayName }.
//
// Le parent maintient userId et displayName séparément (v-model:user-id /
// v-model:display-name) ; ce composant traduit la sélection/création en ces
// deux émissions.
import type { PlayerOption } from '../utils/team-player-options'

const props = defineProps<{
  userId: string | null
  displayName: string
  options: PlayerOption[]
  placeholder: string
}>()

const emit = defineEmits<{
  (e: 'update:userId', value: string | null): void
  (e: 'update:displayName', value: string): void
}>()

// Item du combobox. `value` = userId (clé de comparaison via `by`). Le label
// d'une option grisée porte le suffixe explicatif ; une option grisée n'étant
// pas sélectionnable (USelectMenu bloque onSelect), un item sélectionné a
// toujours un label = pseudo brut.
type Item = {
  value: string
  label: string
  displayName: string
  disabled: boolean
}

const SENTINEL_FREE = ''

const items = computed<Item[]>(() =>
  props.options.map(option => ({
    value: option.userId,
    label: option.disabledReason
      ? `${option.displayName} (${option.disabledReason})`
      : option.displayName,
    displayName: option.displayName,
    disabled: option.disabled,
  })),
)

// Représentation de la valeur courante pour le combobox. Pour un joueur lié,
// l'item correspondant (avec fallback si le profil n'est plus dans les options,
// ex. dé-hydratation). Pour un nom libre non vide, un item synthétique. Sinon
// rien.
const selectedItem = computed<Item | undefined>(() => {
  if (props.userId !== null) {
    return (
      items.value.find(item => item.value === props.userId)
      ?? {
        value: props.userId,
        label: props.displayName,
        displayName: props.displayName,
        disabled: false,
      }
    )
  }
  if (props.displayName.trim() !== '') {
    return {
      value: SENTINEL_FREE,
      label: props.displayName,
      displayName: props.displayName,
      disabled: false,
    }
  }
  return undefined
})

function onSelect(item: Item | undefined) {
  if (item === undefined) {
    emit('update:userId', null)
    emit('update:displayName', '')
    return
  }
  emit('update:userId', item.value === SENTINEL_FREE ? null : item.value)
  emit('update:displayName', item.displayName)
}

// L'utilisateur a tapé un nom qui ne correspond à aucun invité : joueur libre.
function onCreate(rawName: string) {
  emit('update:userId', null)
  emit('update:displayName', rawName)
}
</script>

<template>
  <USelectMenu
    :model-value="selectedItem"
    :items="items"
    by="value"
    label-key="label"
    :placeholder="placeholder"
    :create-item="true"
    :search-input="{ placeholder: 'Rechercher ou saisir un nom…' }"
    @update:model-value="onSelect"
    @create="onCreate"
  >
    <template #create-item-label="{ item }">
      Garder « {{ item }} » comme nom libre
    </template>
  </USelectMenu>
</template>
