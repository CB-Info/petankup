<script setup lang="ts">
const route = useRoute()
const tournamentId = computed(() => route.params.tournamentId as string)
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold text-horizon-900">
      Détail du tournoi
    </h1>
    <p class="mt-2 text-[#5C5A54]">
      À venir (ticket #8) — id : {{ tournamentId }}
    </p>
  </div>
</template>
