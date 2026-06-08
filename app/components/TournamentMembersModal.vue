<script setup lang="ts">
// Modal de gestion des invités d'un tournoi privé. Visible uniquement
// pour l'owner (gating fait par le bouton parent — pas de défense en
// profondeur ici). Toutes les mutations passent par les actions store ;
// le composant ne mute jamais currentTournamentMembers en direct.
//
// Pattern d'erreurs :
// - invitation : InviteMemberError mappé en français inline sous l'input.
//   Les erreurs hors invitation (réseau, repo) tombent dans 'unknown'.
// - removeMember + load initial : toast via useErrorToast (la liste reste
//   affichée, l'utilisateur retentera).
import { z } from 'zod'
import { InviteMemberError, type InviteMemberErrorCode, type TournamentMember } from '../types'

// Validation du pseudo saisi avant envoi à la RPC. trim + 1–50 chars,
// aligné sur la CHECK display_name côté DB. La RPC fait elle-même le
// lower(trim(...)) pour le lookup.
const inviteByDisplayNameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Pseudo requis')
    .max(50, '50 caractères maximum'),
})

const props = defineProps<{
  open: boolean
  tournamentId: string
  tournamentName: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

const tournamentStore = useTournamentStore()
const { currentTournamentMembers, profileById } = storeToRefs(tournamentStore)
const { showError } = useErrorToast()
const toast = useToast()

const inviteState = reactive({ displayName: '' })
const inviteError = ref<InviteMemberErrorCode | null>(null)
const isInviting = ref(false)
const removingMemberId = ref<string | null>(null)
const isLoadingMembers = ref(false)

// UForm valide sur la valeur trimmée tout en bindant l'input sur l'état
// brut (même pattern qu'account.vue / TeamFormModal).
const trimmedInviteState = computed(() => ({
  displayName: inviteState.displayName.trim(),
}))

// Affichage live du pseudo de l'invité via le cache profileById. Tant que le
// profil n'est pas hydraté, on affiche un placeholder neutre — JAMAIS l'email
// (l'invitant invite par pseudo et ne doit pas voir l'email du membre). Le
// pseudo étant NOT NULL + unique depuis la Phase D, aucun fallback email n'a
// de raison d'exister.
function memberDisplayName(member: TournamentMember): string {
  return profileById.value[member.userId]?.displayName ?? '…'
}

// Hydrate les profils des membres affichés à chaque évolution de la liste.
// void : fire-and-forget, best-effort (loadProfilesByIds ne throw pas).
watch(
  currentTournamentMembers,
  (members) => {
    const memberUserIds = members.map(member => member.userId)
    if (memberUserIds.length > 0) {
      void tournamentStore.loadProfilesByIds(memberUserIds)
    }
  },
  { immediate: true },
)

// Token UI pour invalider les side-effects locaux (isLoadingMembers,
// showError) sur réponse tardive d'un load précédent. Local au setup
// — chaque instance du modal a son propre compteur.
//
// Le store a déjà son propre token (lastLoadTournamentMembersRequestId)
// qui protège currentTournamentMembers, mais il ne couvre pas les flags
// du composant : sans ce token UI, un load(A) qui résoudrait après un
// load(B) (réouverture du modal sur un autre tournoi pendant que A
// traîne) déclencherait un flip prématuré de isLoadingMembers et un
// toast pour une erreur qui n'intéresse plus l'utilisateur.
let lastLoadMembersUiRequestId = 0

async function loadAndReset(tournamentId: string): Promise<void> {
  const requestId = ++lastLoadMembersUiRequestId
  inviteState.displayName = ''
  inviteError.value = null
  removingMemberId.value = null
  isLoadingMembers.value = true
  try {
    await tournamentStore.loadTournamentMembers(tournamentId)
  }
  catch (error) {
    if (requestId === lastLoadMembersUiRequestId) showError(error)
  }
  finally {
    if (requestId === lastLoadMembersUiRequestId) {
      isLoadingMembers.value = false
    }
  }
}

// Source composée sur [open, tournamentId] pour couvrir aussi un re-bind
// du tournamentId pendant que le modal est ouvert (cas défensif). Non
// immediate : le modal est inerte tant que open === false.
watch(
  [() => props.open, () => props.tournamentId],
  ([isOpen, tournamentId]) => {
    if (!isOpen) return
    void loadAndReset(tournamentId)
  },
)

async function submitInvite(): Promise<void> {
  // Garde-fous ceinture+bretelle (les :disabled du formulaire les
  // couvrent déjà, mais on protège un appel programmatique imprévu).
  // Le check isLoadingMembers en particulier coupe la race load↔invite
  // qui ferait disparaître le membre fraîchement ajouté quand la
  // réponse tardive du load arrive APRÈS l'append de l'invite.
  if (isLoadingMembers.value) return
  if (inviteState.displayName.trim() === '') return
  if (isInviting.value) return

  isInviting.value = true
  inviteError.value = null
  try {
    await tournamentStore.inviteMemberByDisplayName(
      props.tournamentId,
      inviteState.displayName.trim(),
    )
    inviteState.displayName = ''
  }
  catch (error) {
    if (error instanceof InviteMemberError) {
      inviteError.value = error.code
    }
    else {
      inviteError.value = 'unknown'
    }
  }
  finally {
    isInviting.value = false
  }
}

async function removeMemberAt(member: TournamentMember): Promise<void> {
  if (removingMemberId.value !== null) return
  removingMemberId.value = member.id
  try {
    await tournamentStore.removeMember(member.id)
  }
  catch (error) {
    // member_in_team : le membre figure dans une équipe du tournoi. Ce n'est
    // pas une erreur technique mais une condition métier → toast d'avertissement
    // explicite plutôt que le toast d'erreur générique.
    if (error instanceof InviteMemberError && error.code === 'member_in_team') {
      toast.add({
        title: 'Membre dans une équipe',
        description: "Retirez-le d'abord de son équipe avant de pouvoir le désinviter.",
        color: 'warning',
        icon: 'i-lucide-alert-triangle',
      })
      return
    }
    showError(error)
  }
  finally {
    removingMemberId.value = null
  }
}

// Switch exhaustif sans default : TypeScript signalera tout code ajouté
// à InviteMemberErrorCode qui ne serait pas mappé ici.
function inviteErrorMessage(code: InviteMemberErrorCode): string {
  switch (code) {
    case 'not_authenticated':
      return 'Vous devez être connecté.'
    case 'not_owner':
      return "Action réservée à l'organisateur du tournoi."
    case 'display_name_not_found':
      return 'Pseudo introuvable.'
    case 'self_invite':
      return 'Vous ne pouvez pas vous inviter vous-même.'
    case 'already_member':
      return 'Cette personne est déjà invitée.'
    case 'tournament_completed':
      return 'Ce tournoi est terminé, plus aucune invitation possible.'
    case 'member_in_team':
      // Non déclenché par l'invitation (propre au retrait de membre, traité
      // par un toast dédié dans removeMemberAt) ; présent pour l'exhaustivité.
      return 'Action impossible.'
    case 'unknown':
      return 'Une erreur est survenue. Réessayez.'
  }
}
</script>

<template>
  <UModal
    v-model:open="openModel"
    :title="`Gérer les invités — ${tournamentName}`"
  >
    <template #body>
      <div class="space-y-3">
        <p v-if="isLoadingMembers" class="text-sm text-toned">
          Chargement…
        </p>
        <p
          v-else-if="currentTournamentMembers.length === 0"
          class="text-sm text-toned"
        >
          Aucun invité pour l'instant. Ajoutez le premier ci-dessous.
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="member in currentTournamentMembers"
            :key="member.id"
            class="flex items-center justify-between gap-2 rounded-lg border border-default bg-elevated p-3"
          >
            <p class="min-w-0 truncate text-sm text-default">
              {{ memberDisplayName(member) }}
            </p>
            <UButton
              variant="ghost"
              color="neutral"
              icon="i-lucide-trash-2"
              size="sm"
              :loading="removingMemberId === member.id"
              :disabled="
                removingMemberId !== null && removingMemberId !== member.id
              "
              aria-label="Retirer cet invité"
              @click="removeMemberAt(member)"
            />
          </li>
        </ul>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <UForm
          :schema="inviteByDisplayNameSchema"
          :state="trimmedInviteState"
          class="flex flex-col gap-2"
          @submit="submitInvite"
        >
          <UFormField
            label="Inviter par pseudo"
            name="displayName"
            :error="
              inviteError !== null ? inviteErrorMessage(inviteError) : undefined
            "
          >
            <UInput
              v-model="inviteState.displayName"
              placeholder="Pseudo de l'invité"
              :disabled="isLoadingMembers || isInviting"
              class="w-full"
            />
          </UFormField>
          <UButton
            type="submit"
            color="primary"
            size="lg"
            :loading="isInviting"
            :disabled="
              isLoadingMembers || isInviting
                || inviteState.displayName.trim() === ''
            "
            block
          >
            Inviter
          </UButton>
        </UForm>
        <UButton
          variant="ghost"
          color="neutral"
          block
          @click="openModel = false"
        >
          Fermer
        </UButton>
      </div>
    </template>
  </UModal>
</template>
