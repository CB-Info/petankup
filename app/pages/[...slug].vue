<script setup lang="ts">
useHead({ title: "Page introuvable — Pétankup" });
</script>

<template>
  <div class="space-y-4 py-12 text-center">
    <h1 class="text-2xl font-semibold text-horizon-900">Page introuvable</h1>
    <p class="text-sm text-[#5C5A54]">
      La page que vous cherchez n'existe pas ou a été déplacée.
    </p>
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left">
      Retour à l'accueil
    </UButton>
  </div>
</template>
