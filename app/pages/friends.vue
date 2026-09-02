<script setup lang="ts">
// Écran des amis (A3) : les trois listes (amis, demandes reçues, demandes
// envoyées) derrière des onglets FiltrePilules, et le champ de recherche
// par pseudo exact — le SEUL point d'entrée d'une relation.
//
// La recherche est une action du store PROFIL (findAccountByDisplayName,
// précédent FreeMatchPlayerInput) : le store friendship ne porte que les
// relations. Un pseudo introuvable est un cas NOMINAL (résultat vide),
// jamais une erreur. L'état vis-à-vis du compte trouvé est dérivé du
// bundle VIVANT (friendshipSearchOutcome) : il s'affiche AVANT tout appui
// et propose l'action adaptée (Accepter pour une demande reçue, rien pour
// soi-même) — les codes de refus de la base ne sont que des filets de
// course.
//
// Erreurs : jamais un code brut à l'écran — tout passe par
// useFriendshipFeedback ; les codes imputables à la saisie du pseudo
// (friendshipErrorField) s'affichent inline sous le champ.
import type { AccountMatch, FriendshipEntry } from "../types";
import {
  friendshipErrorField,
  friendshipErrorMessage,
} from "../utils/friendship-errors";
import { friendshipSearchOutcome } from "../utils/friendship";

const friendshipStore = useFriendshipStore();
const { friendshipBundle, lastLoadFriendshipsError, receivedRequestCount }
  = storeToRefs(friendshipStore);
const { isActionPending } = friendshipStore;
const profileStore = useProfileStore();
const identityStore = useIdentityStore();
const { currentUserId } = storeToRefs(identityStore);
const { decodeFriendshipErrorCode, showFriendshipError, showRequestOutcome } =
  useFriendshipFeedback();

// Rafraîchissement (pas le lazy) à chaque entrée : c'est l'écran qu'on
// ouvre POUR les demandes — il doit voir celles arrivées en cours de
// session. Gaté sur l'identité (pattern account.vue).
watch(
  currentUserId,
  (userId) => {
    if (userId !== null) void friendshipStore.refreshFriendships();
  },
  { immediate: true },
);

const { set: setHeader } = useAppHeader();
setHeader({
  mode: "interne",
  kicker: "Compte",
  title: "Amis",
  back: { label: "Mon compte", to: "/account" },
});

useHead({ title: "Amis — Pétankup" });

// --- Onglets ---

type FriendshipTab = "friends" | "received" | "sent";
const activeTab = ref<FriendshipTab>("friends");

// À la première observation d'un bundle sur CETTE visite : ouvrir
// directement les demandes reçues s'il y en a (on vient souvent ici depuis
// le compteur du compte). == null (et pas ===) : au déclenchement
// immediate, previousBundle vaut undefined — le cas « bundle déjà en cache
// au mount » doit aussi basculer. Les rafraîchissements suivants ne
// re-basculent pas (l'utilisateur a pu changer d'onglet).
watch(
  friendshipBundle,
  (bundle, previousBundle) => {
    if (previousBundle == null && bundle !== null && bundle.received.length > 0) {
      activeTab.value = "received";
    }
  },
  { immediate: true },
);

const tabOptions = computed(() => [
  { value: "friends" as const, label: "Amis" },
  {
    value: "received" as const,
    label:
      receivedRequestCount.value > 0
        ? `Reçues (${receivedRequestCount.value})`
        : "Reçues",
  },
  { value: "sent" as const, label: "Envoyées" },
]);

// --- Recherche (état local de page : le store friendship n'en porte pas) ---

const searchInput = ref("");
const searchResult = ref<AccountMatch | null>(null);
const hasSearched = ref(false);
const isSearching = ref(false);
const searchInlineError = ref<string | null>(null);

const canSearch = computed(() => searchInput.value.trim().length > 0);

const searchOutcome = computed(() =>
  friendshipSearchOutcome(
    hasSearched.value,
    searchResult.value,
    searchResult.value === null
      ? "none"
      : friendshipStore.friendshipStatusOf(searchResult.value.userId),
  ),
);

async function onSearchSubmit() {
  const displayName = searchInput.value.trim();
  if (isSearching.value || displayName.length === 0) return;
  isSearching.value = true;
  searchInlineError.value = null;
  try {
    const account = await profileStore.findAccountByDisplayName(displayName);
    searchResult.value = account;
    hasSearched.value = true;
  } catch (error) {
    // find_account peut lever not_authenticated en Error nue : même
    // décodage que les actions, jamais de message brut.
    showFriendshipError(error);
  } finally {
    isSearching.value = false;
  }
}

function clearSearch() {
  searchInput.value = "";
  searchResult.value = null;
  hasSearched.value = false;
  searchInlineError.value = null;
}

// Demande depuis la carte de résultat. L'issue est dite honnêtement :
// des demandes croisées rendent amis immédiatement (A7).
const isSubmittingSearchRequest = ref(false);

async function requestFromSearch(account: AccountMatch) {
  if (isSubmittingSearchRequest.value) return;
  isSubmittingSearchRequest.value = true;
  searchInlineError.value = null;
  try {
    const outcome = await friendshipStore.requestFriendship(account.displayName);
    showRequestOutcome(outcome);
    clearSearch();
    // Montrer la liste où la relation a atterri, sans tap supplémentaire.
    activeTab.value = outcome === "accepted" ? "friends" : "sent";
  } catch (error) {
    const code = decodeFriendshipErrorCode(error);
    if (friendshipErrorField(code) === "displayName") {
      searchInlineError.value = friendshipErrorMessage(code);
      return;
    }
    showFriendshipError(error);
  } finally {
    isSubmittingSearchRequest.value = false;
  }
}

// --- Actions sur les listes (throw du store → feedback traduit) ---

async function acceptRequest(entry: FriendshipEntry) {
  try {
    await friendshipStore.acceptFriendship(entry.userId);
  } catch (error) {
    showFriendshipError(error);
  }
}

async function refuseRequest(entry: FriendshipEntry) {
  try {
    await friendshipStore.refuseFriendship(entry.userId);
  } catch (error) {
    showFriendshipError(error);
  }
}

async function cancelSentRequest(entry: FriendshipEntry) {
  try {
    await friendshipStore.cancelFriendshipRequest(entry.userId);
  } catch (error) {
    showFriendshipError(error);
  }
}

// Retirer un ami : seule action destructrice d'une relation établie —
// confirmée par modal (moule des confirm-modals du dépôt).
const friendPendingRemoval = ref<FriendshipEntry | null>(null);
const isRemovalModalOpen = ref(false);

function askRemoval(entry: FriendshipEntry) {
  friendPendingRemoval.value = entry;
  isRemovalModalOpen.value = true;
}

async function confirmRemoval() {
  const friend = friendPendingRemoval.value;
  if (friend === null || isActionPending(friend.userId)) return;
  try {
    await friendshipStore.removeFriendship(friend.userId);
    isRemovalModalOpen.value = false;
    friendPendingRemoval.value = null;
  } catch (error) {
    showFriendshipError(error);
  }
}

// --- Navigation vers un profil : la flèche du profil ramènera ici ---

const { rememberOrigin } = useBackOrigin();

function rememberFriendsOrigin(event: MouseEvent, targetUserId: string): void {
  const opensOutsideThisTab =
    event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0;
  if (opensOutsideThisTab) return;
  rememberOrigin(`/profile/${targetUserId}`, "/friends");
}

// --- Réessayer (règle : identité d'abord, sinon les listes) ---

const isRetrying = ref(false);

async function retryLoadFriendships() {
  if (isRetrying.value) return;
  isRetrying.value = true;
  try {
    if (currentUserId.value === null) {
      await identityStore.resolveForCurrentSession();
      return;
    }
    await friendshipStore.refreshFriendships();
  } finally {
    isRetrying.value = false;
  }
}

const FIELD_BASE_CLASS =
  "h-12.75 w-full rounded-(--pk-r-md) border-[1.5px] border-(--pk-line) bg-(--pk-card) px-3.5 font-sans text-[15.5px] text-(--pk-ink) placeholder:text-(--pk-muted)";
const PERSON_ROW_CLASS =
  "flex items-center gap-3 rounded-[14px] border-[1.5px] border-(--pk-line) bg-(--pk-card) px-3.5 py-2.75 shadow-(--pk-shadow-card)";
const PERSON_NAME_CLASS =
  "min-w-0 flex-1 truncate font-sans text-[15px] font-semibold text-(--pk-ink)";
const STATUS_MENTION_CLASS = "font-sans text-xs text-(--pk-subtle)";
</script>

<template>
  <div class="space-y-5">
    <!-- Chargement / erreur : uniquement tant qu'aucun bundle n'est en
         place — des listes chargées restent affichées pendant les
         rafraîchissements et les actions (pas de clignotement). -->
    <p
      v-if="friendshipBundle === null && lastLoadFriendshipsError === null"
      class="py-16 text-center font-sans text-sm text-(--pk-subtle)"
    >
      Chargement…
    </p>

    <div
      v-else-if="friendshipBundle === null"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Amis indisponibles
      </h2>
      <p class="font-sans text-sm text-(--pk-subtle)">
        Vérifiez votre connexion et réessayez.
      </p>
      <UButton
        color="primary"
        block
        :loading="isRetrying"
        class="mt-2 h-13 rounded-[13px] font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
        @click="retryLoadFriendships"
      >
        Réessayer
      </UButton>
    </div>

    <template v-else>
      <!-- Recherche par pseudo exact — seul point d'entrée d'une relation. -->
      <form class="space-y-2.5" @submit.prevent="onSearchSubmit">
        <UFormField
          label="Ajouter un joueur"
          name="displayName"
          :error="searchInlineError ?? undefined"
          :ui="{
            label:
              'font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)',
          }"
        >
          <div class="flex gap-2">
            <UInput
              v-model="searchInput"
              placeholder="Pseudo exact"
              icon="i-lucide-search"
              variant="none"
              class="min-w-0 flex-1"
              :ui="{
                base: `${FIELD_BASE_CLASS} ps-10.5`,
                leadingIcon: 'size-4.5 text-(--pk-muted)',
              }"
            />
            <UButton
              type="submit"
              color="navy"
              :loading="isSearching"
              :disabled="!canSearch"
              class="h-12.75 shrink-0 rounded-(--pk-r-md) px-4 font-disp text-[12.5px] font-extrabold tracking-[0.03em] uppercase"
            >
              Rechercher
            </UButton>
          </div>
        </UFormField>

        <!-- Résultat : l'état est indiqué AVANT d'appuyer, l'action est
             adaptée. Introuvable = phrase neutre, jamais une erreur. -->
        <p
          v-if="searchOutcome === 'not_found'"
          class="font-sans text-sm text-(--pk-subtle)"
        >
          Aucun compte ne porte ce pseudo.
        </p>

        <div
          v-else-if="searchOutcome !== 'idle' && searchResult !== null"
          :class="PERSON_ROW_CLASS"
        >
          <BouleAvatar tone="horizon" :size="40">
            <span class="text-(--pk-navy)">
              {{ searchResult.displayName.charAt(0).toUpperCase() }}
            </span>
          </BouleAvatar>
          <div class="min-w-0 flex-1">
            <NuxtLink
              :to="`/profile/${searchResult.userId}`"
              :class="PERSON_NAME_CLASS"
              class="block"
              @click="rememberFriendsOrigin($event, searchResult.userId)"
            >
              {{ searchResult.displayName }}
            </NuxtLink>
            <p v-if="searchOutcome === 'self'" :class="STATUS_MENTION_CLASS">
              C'est vous
            </p>
            <p
              v-else-if="searchOutcome === 'friends'"
              :class="STATUS_MENTION_CLASS"
            >
              Vous êtes amis
            </p>
            <p
              v-else-if="searchOutcome === 'request_sent'"
              :class="STATUS_MENTION_CLASS"
            >
              Demande envoyée
            </p>
            <p
              v-else-if="searchOutcome === 'request_received'"
              :class="STATUS_MENTION_CLASS"
            >
              Vous a envoyé une demande
            </p>
          </div>
          <UButton
            v-if="searchOutcome === 'none'"
            color="primary"
            :loading="isSubmittingSearchRequest"
            class="h-11 shrink-0 rounded-[12px] px-3.5 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase text-(--pk-cream)"
            @click="requestFromSearch(searchResult)"
          >
            Envoyer une demande
          </UButton>
          <UButton
            v-else-if="searchOutcome === 'request_received'"
            color="primary"
            :loading="isActionPending(searchResult.userId, 'accept')"
            class="h-11 shrink-0 rounded-[12px] px-3.5 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase text-(--pk-cream)"
            @click="acceptRequest(searchResult)"
          >
            Accepter
          </UButton>
          <UButton
            v-else-if="searchOutcome === 'request_sent'"
            variant="ghost"
            color="neutral"
            :loading="isActionPending(searchResult.userId, 'cancel')"
            class="h-11 shrink-0 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase"
            @click="cancelSentRequest(searchResult)"
          >
            Annuler
          </UButton>
        </div>
      </form>

      <FiltrePilules v-model="activeTab" :options="tabOptions" />

      <!-- Amis -->
      <ul v-if="activeTab === 'friends' && friendshipBundle.friends.length > 0" class="space-y-2.5">
        <li
          v-for="friend in friendshipBundle.friends"
          :key="friend.userId"
          :class="PERSON_ROW_CLASS"
        >
          <BouleAvatar tone="gold" :size="40">
            <span class="text-(--pk-navy)">
              {{ friend.displayName.charAt(0).toUpperCase() }}
            </span>
          </BouleAvatar>
          <NuxtLink
            :to="`/profile/${friend.userId}`"
            :class="PERSON_NAME_CLASS"
            @click="rememberFriendsOrigin($event, friend.userId)"
          >
            {{ friend.displayName }}
          </NuxtLink>
          <UButton
            variant="ghost"
            color="error"
            :loading="isActionPending(friend.userId, 'remove')"
            class="h-11 shrink-0 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase"
            @click="askRemoval(friend)"
          >
            Retirer
          </UButton>
        </li>
      </ul>
      <p
        v-else-if="activeTab === 'friends'"
        class="py-8 text-center font-sans text-sm text-(--pk-subtle)"
      >
        Aucun ami pour l'instant. Recherchez un joueur par son pseudo pour
        envoyer une demande.
      </p>

      <!-- Demandes reçues -->
      <ul
        v-if="activeTab === 'received' && friendshipBundle.received.length > 0"
        class="space-y-2.5"
      >
        <li
          v-for="request in friendshipBundle.received"
          :key="request.userId"
          :class="PERSON_ROW_CLASS"
        >
          <BouleAvatar tone="horizon" :size="40">
            <span class="text-(--pk-navy)">
              {{ request.displayName.charAt(0).toUpperCase() }}
            </span>
          </BouleAvatar>
          <NuxtLink
            :to="`/profile/${request.userId}`"
            :class="PERSON_NAME_CLASS"
            @click="rememberFriendsOrigin($event, request.userId)"
          >
            {{ request.displayName }}
          </NuxtLink>
          <div class="flex shrink-0 gap-1.5">
            <UButton
              color="primary"
              :loading="isActionPending(request.userId, 'accept')"
              :disabled="isActionPending(request.userId)"
              class="h-11 rounded-[12px] px-3.5 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase text-(--pk-cream)"
              @click="acceptRequest(request)"
            >
              Accepter
            </UButton>
            <UButton
              variant="ghost"
              color="neutral"
              :loading="isActionPending(request.userId, 'refuse')"
              :disabled="isActionPending(request.userId)"
              class="h-11 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase"
              @click="refuseRequest(request)"
            >
              Refuser
            </UButton>
          </div>
        </li>
      </ul>
      <p
        v-else-if="activeTab === 'received'"
        class="py-8 text-center font-sans text-sm text-(--pk-subtle)"
      >
        Aucune demande reçue.
      </p>

      <!-- Demandes envoyées -->
      <ul
        v-if="activeTab === 'sent' && friendshipBundle.sent.length > 0"
        class="space-y-2.5"
      >
        <li
          v-for="request in friendshipBundle.sent"
          :key="request.userId"
          :class="PERSON_ROW_CLASS"
        >
          <BouleAvatar tone="horizon" :size="40">
            <span class="text-(--pk-navy)">
              {{ request.displayName.charAt(0).toUpperCase() }}
            </span>
          </BouleAvatar>
          <NuxtLink
            :to="`/profile/${request.userId}`"
            :class="PERSON_NAME_CLASS"
            @click="rememberFriendsOrigin($event, request.userId)"
          >
            {{ request.displayName }}
          </NuxtLink>
          <UButton
            variant="ghost"
            color="neutral"
            :loading="isActionPending(request.userId, 'cancel')"
            class="h-11 shrink-0 font-disp text-[11.5px] font-extrabold tracking-[0.03em] uppercase"
            @click="cancelSentRequest(request)"
          >
            Annuler
          </UButton>
        </li>
      </ul>
      <p
        v-else-if="activeTab === 'sent'"
        class="py-8 text-center font-sans text-sm text-(--pk-subtle)"
      >
        Aucune demande envoyée.
      </p>
    </template>

    <FriendRemoveConfirmModal
      v-model:open="isRemovalModalOpen"
      :friend-display-name="friendPendingRemoval?.displayName ?? ''"
      :is-submitting="friendPendingRemoval !== null && isActionPending(friendPendingRemoval.userId, 'remove')"
      @confirmed="confirmRemoval"
    />
  </div>
</template>
