<script setup lang="ts">
// Layout shell : header sticky + zone de contenu centrée mobile-first.
// Couleurs hardcodées en hexa (et pas via les rampes) parce qu'elles
// proviennent des tokens neutres de la charte (#FAFAF6 / #F2F0EB / …),
// indépendants du système 50→950 de Tailwind.
</script>

<template>
  <div class="min-h-screen bg-[#FAFAF6] text-[#2C2A25]">
    <header class="sticky top-0 z-10 border-b border-[#E5E2DB] bg-[#F2F0EB]">
      <div class="mx-auto flex min-h-14 max-w-2xl items-center px-4 py-3">
        <NuxtLink to="/" class="text-lg font-semibold text-horizon-900">
          Pétanque
        </NuxtLink>
      </div>
    </header>

    <main class="mx-auto max-w-2xl p-4">
      <slot />
    </main>
  </div>
</template>
