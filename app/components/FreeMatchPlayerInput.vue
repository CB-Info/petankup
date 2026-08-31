<script setup lang="ts">
// Saisie d'un joueur de match libre : un nom tapé au clavier, puis — au blur
// ou à Entrée — recherche du compte portant EXACTEMENT ce pseudo. Trouvé :
// proposition de lier le compte (pseudo canonique, stats créditées). Non
// trouvé : joueur libre, cas nominal (aucune erreur). Pas de liste où
// piocher (un match libre n'a pas d'invités), pas de recherche à la frappe :
// une requête par nom distinct, mémorisée par slot.
//
// Le parent maintient { userId, displayName } via deux v-model, comme
// PlayerSlotInput. Trois états visuels : verrouillé (le créateur : pas de
// saisie, pas de Délier), lié (pseudo canonique + Délier), libre (saisie).
// La distinction compte / joueur libre est visible sur chaque ligne avant
// l'enregistrement.
import type { AccountMatch } from '../types'

const props = withDefaults(
  defineProps<{
    userId: string | null
    displayName: string
    placeholder: string
    // Comptes déjà présents ailleurs dans le match : « Lier » est refusé pour
    // eux (un compte ne joue qu'une fois — règle Zod + base, reflétée ici).
    takenUserIds: string[]
    locked?: boolean
  }>(),
  { locked: false },
)

const emit = defineEmits<{
  (e: 'update:userId', value: string | null): void
  (e: 'update:displayName', value: string): void
}>()

const profileStore = useProfileStore()
const { showError } = useErrorToast()

type AccountLookup = {
  // Même normalisation que la base (lower(trim)) : retaper le même nom avec
  // une autre casse ne relance pas la requête.
  normalizedName: string
  account: AccountMatch | null
}

// Dernière recherche effectuée pour ce slot. Sert de mémo et de source du
// statut affiché, tant que le nom saisi lui correspond encore.
const lastLookup = ref<AccountLookup | null>(null)
const isLookingUp = ref(false)

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

const normalizedDisplayName = computed(() => normalizeName(props.displayName))

const lookupForCurrentName = computed<AccountLookup | null>(() => {
  const lookup = lastLookup.value
  if (lookup === null || lookup.normalizedName !== normalizedDisplayName.value) return null
  return lookup
})

const foundAccount = computed<AccountMatch | null>(
  () => lookupForCurrentName.value?.account ?? null,
)

const isKnownFreePlayer = computed(
  () => lookupForCurrentName.value !== null && foundAccount.value === null,
)

const foundAccountIsAlreadyInMatch = computed(() => {
  const account = foundAccount.value
  return account !== null && props.takenUserIds.includes(account.userId)
})

function onInput(value: string | number) {
  emit('update:displayName', String(value))
}

async function lookupAccount() {
  if (props.userId !== null || isLookingUp.value) return
  const normalizedName = normalizedDisplayName.value
  if (normalizedName === '') return
  if (lastLookup.value?.normalizedName === normalizedName) return

  isLookingUp.value = true
  try {
    const account = await profileStore.findAccountByDisplayName(props.displayName)
    lastLookup.value = { normalizedName, account }
  }
  catch (error) {
    showError(error)
  }
  finally {
    isLookingUp.value = false
  }
}

function linkAccount() {
  const account = foundAccount.value
  if (account === null || foundAccountIsAlreadyInMatch.value) return
  emit('update:userId', account.userId)
  emit('update:displayName', account.displayName)
}

// Délier garde le pseudo canonique comme nom libre (modifiable) ; le mémo
// de recherche s'applique toujours, la proposition « Lier » réapparaît.
function unlinkAccount() {
  emit('update:userId', null)
}

// Mêmes valeurs de champ que les écrans Créer un tournoi / Mon compte.
const FIELD_BASE_CLASS
  = 'h-12.75 w-full rounded-(--pk-r-md) border-[1.5px] border-(--pk-line) bg-(--pk-card) px-3.5 font-sans text-[15.5px] text-(--pk-ink) placeholder:text-(--pk-muted)'
</script>

<template>
  <div>
    <div
      v-if="userId !== null"
      class="flex h-12.75 items-center gap-2.5 rounded-(--pk-r-md) border-[1.5px] border-(--pk-line) bg-(--pk-card) ps-3.5 pe-1.5"
    >
      <span class="min-w-0 flex-1 truncate font-sans text-[15.5px] text-(--pk-ink)">
        <span v-if="locked" class="text-(--pk-muted)">Moi · </span>{{ displayName }}
      </span>
      <UBadge
        color="secondary"
        variant="subtle"
        size="sm"
        class="shrink-0"
      >
        Compte
      </UBadge>
      <UButton
        v-if="!locked"
        variant="ghost"
        color="neutral"
        class="h-11 shrink-0"
        :aria-label="`Délier le compte de ${displayName}`"
        @click="unlinkAccount"
      >
        Délier
      </UButton>
    </div>

    <template v-else>
      <UInput
        :model-value="displayName"
        :placeholder="placeholder"
        :loading="isLookingUp"
        autocomplete="off"
        variant="none"
        class="w-full"
        :ui="{ base: FIELD_BASE_CLASS }"
        @update:model-value="onInput"
        @blur="lookupAccount"
        @keydown.enter.prevent="lookupAccount"
      />

      <div v-if="foundAccount" class="mt-1.5 flex flex-wrap items-center gap-2">
        <UBadge color="secondary" variant="subtle" size="sm">
          {{ foundAccount.displayName }} a un compte
        </UBadge>
        <UButton
          color="primary"
          variant="soft"
          class="h-11"
          :disabled="foundAccountIsAlreadyInMatch"
          @click="linkAccount"
        >
          Lier
        </UButton>
        <span
          v-if="foundAccountIsAlreadyInMatch"
          class="font-sans text-xs text-(--pk-muted)"
        >
          déjà dans le match
        </span>
      </div>
      <div v-else-if="isKnownFreePlayer" class="mt-1.5">
        <UBadge color="neutral" variant="subtle" size="sm">
          Joueur libre
        </UBadge>
      </div>
    </template>
  </div>
</template>
