<script setup lang="ts">
// Page profil joueur (Phase K). Consomme le bundle chargé par le store
// (loadUserProfile, Phase J) : { profile, stats, results }.
//
// Chargement calqué sur tournaments/[tournamentId]/index.vue : flag local
// isLoadingProfile + token de course. On NE dérive PAS l'état "chargement"
// des seuls refs store car loadUserProfile vide currentProfileBundle au
// départ tout en laissant hasFetchedProfileBundle à true entre deux profils
// — sans flag local, une navigation profil→profil rendrait un bundle null.
//
// Header (mode interne) déclaré via useAppHeader, rendu une fois par le layout.

import type { UserTournamentResult } from "../../types";

const route = useRoute();
const tournamentStore = useTournamentStore();
const {
  currentProfileBundle,
  lastLoadProfileBundleError,
  profileById,
  currentProfile,
} = storeToRefs(tournamentStore);
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

// user.sub d'abord, currentProfile en secours : useSupabaseUser n'est pas
// hydraté dans la fenêtre post-magic-link (même fallback que l'accueil) —
// sans lui, son propre journal s'afficherait d'abord sans liens puis
// basculerait sous le doigt.
const myUserId = computed(() => user.value?.sub ?? currentProfile.value?.id);
const isSelfProfile = computed(() => userId.value === myUserId.value);

// Accès dérivés non-null-safe : permettent à vue-tsc de narrower dans le
// template (v-if="profile") sans assertions, et fournissent stats/results à
// leur état par défaut quand le bundle est absent.
const profile = computed(() => currentProfileBundle.value?.profile ?? null);
const stats = computed(() => currentProfileBundle.value?.stats ?? null);
const results = computed(() => currentProfileBundle.value?.results ?? []);

// Noms affichés des coéquipiers d'une entrée (présentation pure) : pseudo
// live si le profil est résolu (pré-hydraté par loadUserProfile), sinon
// snapshot — même pattern que teamPlayersNames sur la page tournoi.
function teammateNamesFor(result: UserTournamentResult): string[] {
  return result.teammates.map((teammate) =>
    getTeammateDisplayName(teammate, profileById.value),
  );
}

// Config header. watchEffect pour suivre le pseudo (arrive après le mount).
const { set: setHeader } = useAppHeader();
watchEffect(() => {
  setHeader({
    mode: "interne",
    kicker: "Profil",
    title: profile.value?.displayName ?? "Profil",
    back: { label: "Accueil", to: "/" },
  });
});

useHead({
  title: computed(() =>
    profile.value
      ? `${profile.value.displayName} — Pétankup`
      : "Profil — Pétankup",
  ),
});
</script>

<template>
  <div>
    <p
      v-if="isLoadingProfile"
      class="py-16 text-center font-sans text-sm text-(--pk-subtle)"
    >
      Chargement du profil…
    </p>

    <div
      v-else-if="lastLoadProfileBundleError"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Impossible de charger le profil
      </h2>
      <p class="font-sans text-sm text-(--pk-subtle)">
        Vérifiez votre connexion et réessayez.
      </p>
      <UButton
        color="primary"
        block
        class="mt-2 h-13 rounded-[13px] font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
        @click="loadProfile(userId)"
      >
        Réessayer
      </UButton>
    </div>

    <div
      v-else-if="profile === null"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Profil introuvable
      </h2>
      <UButton
        to="/"
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
      >
        Retour à l'accueil
      </UButton>
    </div>

    <div v-else-if="profile" class="space-y-6">
      <!-- Hero : boule + pseudo + (soi uniquement) bouton Modifier -->
      <div class="flex flex-col items-center gap-3 pt-2 text-center">
        <BouleAvatar
          tone="gold"
          :size="96"
          :aria-label="`Profil de ${profile.displayName}`"
        >
          <span class="text-(--pk-navy)">
            {{ profile.displayName.charAt(0).toUpperCase() }}
          </span>
        </BouleAvatar>
        <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
          {{ profile.displayName }}
        </h2>
        <UButton
          v-if="isSelfProfile"
          to="/account"
          color="primary"
          variant="soft"
          icon="i-lucide-pencil"
          class="h-9.5 rounded-full bg-primary-100 px-4.5 font-disp text-[12.5px] font-extrabold tracking-[0.04em] uppercase"
          :ui="{ leadingIcon: 'size-3.5' }"
        >
          Modifier mes infos
        </UButton>
      </div>

      <ProfileStatsCards :stats="stats" />

      <section class="space-y-3">
        <h2
          class="font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
        >
          Journal de bord
        </h2>
        <p
          v-if="results.length === 0"
          class="font-sans text-sm text-(--pk-subtle)"
        >
          Aucun tournoi joué pour l'instant.
        </p>
        <!-- Sur MON profil : chaque entrée est un lien vers son tournoi
             (visibilité garantie : j'y étais owner ou membre, inamovible).
             Sur le profil d'autrui : cartes statiques — le journal peut
             lister des tournois privés que le visiteur ne peut pas ouvrir,
             et un lien mort est pire que pas de lien. -->
        <ul v-else class="space-y-2.75">
          <li v-for="result in results" :key="result.tournamentId">
            <!-- Pas d'aria-label : le nom accessible dérive du contenu de la
                 carte (rang, tournoi, date, bilan), comme les cartes-liens
                 de l'accueil. -->
            <NuxtLink
              v-if="isSelfProfile"
              :to="`/tournaments/${result.tournamentId}`"
              class="block rounded-(--pk-r-card) transition-opacity hover:opacity-90 active:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <ProfileJournalEntry
                :result="result"
                :teammate-names="teammateNamesFor(result)"
                interactive
              />
            </NuxtLink>
            <ProfileJournalEntry
              v-else
              :result="result"
              :teammate-names="teammateNamesFor(result)"
            />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
