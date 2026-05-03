<script setup lang="ts">
const route = useRoute()
const tournamentId = computed(() => route.params.tournamentId as string)
</script>

<template>
  <div class="space-y-4">
    <UButton
      :to="`/tournaments/${tournamentId}`"
      variant="ghost"
      color="neutral"
      icon="i-lucide-arrow-left"
      size="sm"
    >
      Retour au tournoi
    </UButton>
    <h1 class="text-xl font-semibold text-horizon-900">
      Résultats
    </h1>
    <p class="text-sm text-[#5C5A54]">
      À venir (ticket #9)
    </p>
  </div>
</template>
