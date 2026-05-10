<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
//
// Le déclenchement de loadTournaments() est piloté par le store via un
// watch interne sur currentUserId — couvre boot, magic link et
// changement de compte sans qu'on ait à le faire ici. La page n'a
// qu'à observer hasFetchedTournaments / lastLoadTournamentsError et
// fournir un retry manuel sur erreur.
import type { TournamentStatus } from "../types";

const tournamentStore = useTournamentStore();
const {
  myTournaments,
  sharedTournaments,
  publicTournaments,
  hasFetchedTournaments,
  lastLoadTournamentsError,
} = storeToRefs(tournamentStore);
const { showError } = useErrorToast();

const isRetrying = ref(false);

async function retryLoadTournaments() {
  if (isRetrying.value) return;
  isRetrying.value = true;
  try {
    // On rejoue l'orchestration identité+fetch : si l'erreur initiale
    // venait de getClaims() (fallback magic-link), un retry direct sur
    // loadTournaments partirait sans identité résolue.
    await tournamentStore.loadTournamentsForCurrentSession();
  } catch (error) {
    showError(error);
  } finally {
    isRetrying.value = false;
  }
}

// Ordre d'affichage : en cours d'abord (ce qui se passe maintenant),
// puis brouillons (à finir de préparer), puis terminés (archivés).
const STATUS_DISPLAY_ORDER: Record<TournamentStatus, number> = {
  in_progress: 0,
  draft: 1,
  completed: 2,
};

const sortedMyTournaments = computed(() => {
  return [...myTournaments.value].sort((firstTournament, secondTournament) => {
    const statusDiff =
      STATUS_DISPLAY_ORDER[firstTournament.status] -
      STATUS_DISPLAY_ORDER[secondTournament.status];
    if (statusDiff !== 0) return statusDiff;
    // Date desc : la plus récente en premier (les ISO se comparent comme du texte).
    return secondTournament.date.localeCompare(firstTournament.date);
  });
});

// Tournois partagés (je suis invité, pas owner) : pas de tri par status
// (le membre est spectateur, pas admin — la notion de progression
// d'organisateur n'a pas de sens ici), juste date desc.
const sortedSharedTournaments = computed(() => {
  return [...sharedTournaments.value].sort(
    (firstTournament, secondTournament) =>
      secondTournament.date.localeCompare(firstTournament.date),
  );
});

// Tournois publics d'autres owners : pas de tri par status (lecture
// pure, pas de notion de progression d'admin), juste date desc.
const sortedPublicTournaments = computed(() => {
  return [...publicTournaments.value].sort(
    (firstTournament, secondTournament) =>
      secondTournament.date.localeCompare(firstTournament.date),
  );
});

const mineEmpty = computed(() => sortedMyTournaments.value.length === 0);
const sharedEmpty = computed(() => sortedSharedTournaments.value.length === 0);
const publicEmpty = computed(() => sortedPublicTournaments.value.length === 0);
const allEmpty = computed(
  () => mineEmpty.value && sharedEmpty.value && publicEmpty.value,
);

function statusLabel(status: TournamentStatus): string {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "in_progress":
      return "En cours";
    case "completed":
      return "Terminé";
  }
}

type BadgeColor = "primary" | "secondary" | "success";

function statusBadgeColor(status: TournamentStatus): BadgeColor {
  switch (status) {
    case "in_progress":
      return "primary";
    case "draft":
      return "secondary";
    case "completed":
      return "success";
  }
}

useHead({ title: "Pétankup — Gestion de tournois" });
</script>

<template>
  <div>
    <div v-if="lastLoadTournamentsError" class="space-y-3 py-16 text-center">
      <h2 class="text-lg font-semibold text-primary-900">
        Impossible de charger les tournois
      </h2>
      <p class="text-toned">Vérifiez votre connexion et réessayez.</p>
      <UButton
        color="primary"
        size="lg"
        :loading="isRetrying"
        class="mt-2"
        block
        @click="retryLoadTournaments"
      >
        Réessayer
      </UButton>
    </div>

    <div
      v-else-if="!hasFetchedTournaments"
      class="py-16 text-center"
    >
      <p class="text-toned">Chargement…</p>
    </div>

    <div v-else-if="allEmpty" class="py-16 text-center">
      <h2 class="text-lg font-semibold text-primary-900">
        Aucun tournoi pour l'instant
      </h2>
      <p class="mt-2 text-toned">Créez votre premier tournoi de pétanque</p>
      <UButton
        to="/tournaments/new"
        color="primary"
        size="lg"
        class="mt-6"
        block
      >
        Créer un tournoi
      </UButton>
    </div>

    <div v-else class="space-y-6">
      <UButton to="/tournaments/new" color="primary" size="lg" block>
        Créer un tournoi
      </UButton>

      <section v-if="!mineEmpty" class="space-y-3">
        <h2
          class="text-xs font-semibold uppercase tracking-[0.08em] text-toned"
        >
          Mes tournois
        </h2>
        <ul class="space-y-3">
          <li v-for="tournament in sortedMyTournaments" :key="tournament.id">
            <NuxtLink :to="`/tournaments/${tournament.id}`" class="block">
              <UCard>
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <h3 class="truncate font-semibold text-primary-900">
                      {{ tournament.name }}
                    </h3>
                    <p class="text-sm text-toned">
                      {{ formatDate(tournament.date) }}
                    </p>
                    <p
                      v-if="tournament.location"
                      class="truncate text-sm text-toned"
                    >
                      {{ tournament.location }}
                    </p>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    <UBadge
                      :color="statusBadgeColor(tournament.status)"
                      variant="soft"
                    >
                      {{ statusLabel(tournament.status) }}
                    </UBadge>
                    <VisibilityBadge :visibility="tournament.visibility" />
                  </div>
                </div>
              </UCard>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section v-if="!sharedEmpty" class="space-y-3">
        <h2
          class="text-xs font-semibold uppercase tracking-[0.08em] text-toned"
        >
          Partagés avec moi
        </h2>
        <ul class="space-y-3">
          <li
            v-for="tournament in sortedSharedTournaments"
            :key="tournament.id"
          >
            <NuxtLink :to="`/tournaments/${tournament.id}`" class="block">
              <UCard>
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <h3 class="truncate font-semibold text-primary-900">
                      {{ tournament.name }}
                    </h3>
                    <p class="text-sm text-toned">
                      {{ formatDate(tournament.date) }}
                    </p>
                    <p
                      v-if="tournament.location"
                      class="truncate text-sm text-toned"
                    >
                      {{ tournament.location }}
                    </p>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    <UBadge
                      :color="statusBadgeColor(tournament.status)"
                      variant="soft"
                    >
                      {{ statusLabel(tournament.status) }}
                    </UBadge>
                    <VisibilityBadge :visibility="tournament.visibility" />
                  </div>
                </div>
              </UCard>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section v-if="!publicEmpty" class="space-y-3">
        <h2
          class="text-xs font-semibold uppercase tracking-[0.08em] text-toned"
        >
          Tournois publics
        </h2>
        <ul class="space-y-3">
          <li
            v-for="tournament in sortedPublicTournaments"
            :key="tournament.id"
          >
            <NuxtLink :to="`/tournaments/${tournament.id}`" class="block">
              <UCard>
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <h3 class="truncate font-semibold text-primary-900">
                      {{ tournament.name }}
                    </h3>
                    <p class="text-sm text-toned">
                      {{ formatDate(tournament.date) }}
                    </p>
                    <p
                      v-if="tournament.location"
                      class="truncate text-sm text-toned"
                    >
                      {{ tournament.location }}
                    </p>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    <UBadge
                      :color="statusBadgeColor(tournament.status)"
                      variant="soft"
                    >
                      {{ statusLabel(tournament.status) }}
                    </UBadge>
                    <VisibilityBadge :visibility="tournament.visibility" />
                  </div>
                </div>
              </UCard>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
