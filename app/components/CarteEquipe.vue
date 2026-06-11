<script setup lang="ts">
// Carte d'une équipe dans la liste du tournoi : nom, ligne des joueurs
// (joints par « · »), boutons éditer/supprimer. Le composant SIGNALE les
// intentions via les emits `edit`/`delete` — il ne modifie ni ne supprime
// rien lui-même. L'en-tête de liste (« N équipes inscrites ») et le bouton
// « Ajouter une équipe » vivent dans l'écran, pas ici.

const props = defineProps<{
  name: string;
  players: string[];
}>();

const emit = defineEmits<{
  edit: [];
  delete: [];
}>();

const playersLine = computed(() => props.players.join(" · "));
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
        <p class="mt-0.5 truncate font-sans text-[12.5px] text-(--pk-muted)">
          {{ playersLine }}
        </p>
      </div>

      <div class="flex shrink-0 gap-1.5">
        <UButton
          icon="i-lucide-pencil"
          color="neutral"
          variant="ghost"
          square
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
          :aria-label="`Supprimer l'équipe ${name}`"
          class="size-9 justify-center rounded-[10px] bg-error-100"
          :ui="{ leadingIcon: 'size-3.75' }"
          @click="emit('delete')"
        />
      </div>
    </div>
  </article>
</template>
