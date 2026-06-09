<script setup lang="ts">
// Page profil joueur (Phase K). Consomme le bundle chargé par le store
// (loadUserProfile, Phase J) : { profile, stats, results }.
//
// Chargement calqué sur tournaments/[tournamentId]/index.vue : flag local
// isLoadingProfile + token de course. On NE dérive PAS l'état "chargement"
// des seuls refs store car loadUserProfile vide currentProfileBundle au
// départ tout en laissant hasFetchedProfileBundle à true entre deux profils
// — sans flag local, une navigation profil→profil rendrait un bundle null.
import { formatDate } from "../../utils/format";

const route = useRoute();
const tournamentStore = useTournamentStore();
const { currentProfileBundle, lastLoadProfileBundleError } =
  storeToRefs(tournamentStore);
const user = useSupabaseUser();

const userId = computed(() => route.params.userId as string);

const isLoadingProfile = ref(true);

// Token local : seul le dernier load déclenché a le droit de remettre
// isLoadingProfile à false (anti-flip tardif sur navigation rapide).
let loadProfileRequestId = 0;

async function loadProfile(id: string): Promise<void> {
  const requestId = ++loadProfileRequestId;
  isLoadingProfile.value = true;
  try {
    await tournamentStore.loadUserProfile(id);
  } finally {
    if (requestId === loadProfileRequestId) {
      isLoadingProfile.value = false;
    }
  }
}

// immediate : couvre le mount ET la réutilisation du composant Nuxt sur
// changement de param de route (clic sur un coéquipier d'un autre profil).
watch(
  userId,
  (id) => {
    void loadProfile(id);
  },
  { immediate: true },
);

const isSelfProfile = computed(() => userId.value === user.value?.sub);

// Accès dérivés non-null-safe : permettent à vue-tsc de narrower dans le
// template (v-if="profile") sans assertions, et fournissent stats/results à
// leur état par défaut quand le bundle est absent.
const profile = computed(() => currentProfileBundle.value?.profile ?? null);
const stats = computed(() => currentProfileBundle.value?.stats ?? null);
const results = computed(() => currentProfileBundle.value?.results ?? []);
const lastTournamentAt = computed(
  () => currentProfileBundle.value?.stats?.lastTournamentAt ?? null,
);

useHead({
  title: computed(() =>
    profile.value
      ? `${profile.value.displayName} — Pétankup`
      : "Profil — Pétankup",
  ),
});
</script>

<template>
  <div class="space-y-6">
    <UButton to="/" variant="ghost" color="neutral" size="sm">
      ← Retour à l'accueil
    </UButton>

    <div v-if="isLoadingProfile" class="py-16 text-center">
      <p class="text-toned">Chargement du profil…</p>
    </div>

    <div
      v-else-if="lastLoadProfileBundleError"
      class="space-y-3 py-16 text-center"
    >
      <h1 class="text-lg font-semibold text-primary-900">
        Impossible de charger le profil
      </h1>
      <p class="text-toned">Vérifiez votre connexion et réessayez.</p>
      <UButton
        color="primary"
        size="lg"
        class="mt-2"
        block
        @click="loadProfile(userId)"
      >
        Réessayer
      </UButton>
    </div>

    <div v-else-if="profile === null" class="space-y-3 py-16 text-center">
      <h1 class="text-lg font-semibold text-primary-900">Profil introuvable</h1>
      <UButton to="/" variant="outline" color="primary" size="lg" class="mt-2">
        Retour à l'accueil
      </UButton>
    </div>

    <div v-else-if="profile" class="space-y-6">
      <div class="flex items-center gap-4">
        <UAvatar size="3xl" :alt="profile.displayName" />
        <h1
          class="min-w-0 flex-1 truncate text-2xl font-semibold text-primary-900"
        >
          {{ profile.displayName }}
        </h1>
        <UButton
          v-if="isSelfProfile"
          to="/account"
          variant="outline"
          color="primary"
        >
          Modifier mes infos
        </UButton>
      </div>

      <ProfileStatsCards :stats="stats" />

      <section class="space-y-3">
        <h2
          class="text-xs font-semibold uppercase tracking-[0.08em] text-toned"
        >
          Journal de bord
        </h2>
        <p v-if="results.length === 0" class="text-sm text-toned">
          Aucun tournoi joué pour l'instant.
        </p>
        <ul v-else class="space-y-3">
          <li v-for="result in results" :key="result.tournamentId">
            <ProfileJournalEntry :result="result" />
          </li>
        </ul>
      </section>

      <p v-if="lastTournamentAt" class="text-xs text-muted">
        Dernier tournoi joué le {{ formatDate(lastTournamentAt) }}
      </p>
    </div>
  </div>
</template>
