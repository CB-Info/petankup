<script lang="ts">
// Joueur affiché sur la carte : nom déjà résolu par l'écran (pseudo live ou
// snapshot) + userId pour lier vers le profil. userId null = joueur libre,
// rendu en texte simple (pas de profil, jamais de lien).
export type CarteEquipePlayer = {
  displayName: string;
  userId: string | null;
};
</script>

<script setup lang="ts">
// Carte d'une équipe dans la liste du tournoi : nom, ligne des joueurs
// (séparés par « · », les joueurs à compte liant vers leur profil), boutons
// éditer/supprimer. Le composant SIGNALE les intentions via les emits
// `edit`/`delete` — il ne modifie ni ne supprime rien lui-même. L'en-tête de
// liste (« N équipes inscrites ») et le bouton « Ajouter une équipe » vivent
// dans l'écran, pas ici.
//
// Deux états d'actions DISTINCTS (ne pas fusionner) :
// - `showActions: false` → boutons masqués (l'utilisateur n'a pas le droit,
//   ex. non-owner) ;
// - `actionsDisabled: true` → boutons visibles mais désactivés (le droit
//   existe mais l'état le bloque, ex. tournoi verrouillé).

withDefaults(
  defineProps<{
    name: string;
    players: CarteEquipePlayer[];
    showActions?: boolean;
    actionsDisabled?: boolean;
  }>(),
  {
    showActions: true,
    actionsDisabled: false,
  },
);

const emit = defineEmits<{
  edit: [];
  delete: [];
}>();
</script>

<template>
  <article
    class="overflow-hidden rounded-(--pk-r-card) border border-(--pk-line) bg-(--pk-card) shadow-(--pk-shadow-card-lg)"
  >
    <div class="flex h-16.25 items-center gap-3 px-3.5 py-3.25">
      <div class="min-w-0 flex-1">
        <h3
          class="truncate font-disp text-[16.5px] font-bold tracking-[-0.01em] text-(--pk-ink)"
        >
          {{ name }}
        </h3>
        <!-- Rendu au repos identique à l'ancienne string jointe par « · » ;
             seule l'interactivité s'ajoute sur les joueurs à compte. -->
        <p class="mt-0.5 truncate font-sans text-[12.5px] text-(--pk-muted)">
          <template
            v-for="(player, playerIndex) in players"
            :key="playerIndex"
          >
            <span v-if="playerIndex > 0"> · </span>
            <!-- py-2 sur un élément inline : n'affecte pas la hauteur de
                 ligne (rendu au repos inchangé) mais agrandit la zone de
                 tap verticale — mobile-first. -->
            <NuxtLink
              v-if="player.userId !== null"
              :to="`/profile/${player.userId}`"
              :aria-label="`Voir le profil de ${player.displayName}`"
              class="py-2 hover:underline active:underline focus-visible:outline-2 focus-visible:outline-primary"
            >{{ player.displayName }}</NuxtLink>
            <span v-else>{{ player.displayName }}</span>
          </template>
        </p>
      </div>

      <div v-if="showActions" class="flex shrink-0 gap-1.5">
        <UButton
          icon="i-lucide-pencil"
          color="neutral"
          variant="ghost"
          square
          :disabled="actionsDisabled"
          :aria-label="`Modifier l'équipe ${name}`"
          class="size-9 justify-center rounded-[10px] border border-(--pk-line) bg-(--pk-page) text-(--pk-subtle)"
          :ui="{ leadingIcon: 'size-3.75' }"
          @click="emit('edit')"
        />
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          square
          :disabled="actionsDisabled"
          :aria-label="`Supprimer l'équipe ${name}`"
          class="size-9 justify-center rounded-[10px] bg-error-100"
          :ui="{ leadingIcon: 'size-3.75' }"
          @click="emit('delete')"
        />
      </div>
    </div>
  </article>
</template>
