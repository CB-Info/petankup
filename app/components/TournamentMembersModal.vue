<script setup lang="ts">
// Modal de gestion des invités d'un tournoi privé. Visible uniquement
// pour l'owner (gating fait par le bouton parent — pas de défense en
// profondeur ici). Toutes les mutations passent par les actions store ;
// le composant ne mute jamais currentTournamentMembers en direct.
//
// Pattern d'erreurs :
// - inviteMember : InviteMemberError mappé en français inline sous l'input.
//   Les erreurs hors invitation (réseau, repo) tombent dans 'unknown'.
// - removeMember + load initial : toast via useErrorToast (la liste reste
//   affichée, l'utilisateur retentera).
import { InviteMemberError, type InviteMemberErrorCode, type TournamentMember } from '../types'

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
const { currentTournamentMembers } = storeToRefs(tournamentStore)
const { showError } = useErrorToast()

const inviteEmail = ref('')
const inviteError = ref<InviteMemberErrorCode | null>(null)
const isInviting = ref(false)
const removingMemberId = ref<string | null>(null)
const isLoadingMembers = ref(false)

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
  inviteEmail.value = ''
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
  if (inviteEmail.value.trim() === '') return
  if (isInviting.value) return

  isInviting.value = true
  inviteError.value = null
  try {
    await tournamentStore.inviteMember(props.tournamentId, inviteEmail.value.trim())
    inviteEmail.value = ''
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
    case 'invalid_email':
      return 'Email invalide.'
    case 'not_authenticated':
      return 'Vous devez être connecté.'
    case 'not_owner':
      return "Action réservée à l'organisateur du tournoi."
    case 'user_not_found':
      return 'Aucun compte Pétankup ne correspond à cet email.'
    case 'self_invite':
      return 'Vous ne pouvez pas vous inviter vous-même.'
    case 'already_member':
      return 'Cette personne est déjà invitée.'
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
              {{ member.memberEmail }}
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
        <UFormField
          label="Inviter par email"
          :error="
            inviteError !== null ? inviteErrorMessage(inviteError) : undefined
          "
        >
          <UInput
            v-model="inviteEmail"
            type="email"
            placeholder="ami@exemple.com"
            :disabled="isLoadingMembers || isInviting"
            class="w-full"
            @keydown.enter.prevent="submitInvite"
          />
        </UFormField>
        <UButton
          color="primary"
          size="lg"
          :loading="isInviting"
          :disabled="isLoadingMembers || isInviting || inviteEmail.trim() === ''"
          block
          @click="submitInvite"
        >
          Inviter
        </UButton>
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
