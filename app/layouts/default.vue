<script setup lang="ts">
// Layout shell : header sticky + zone de contenu centrée mobile-first.
// Couleurs neutres servies par les utilitaires sémantiques Nuxt UI, qui
// basculent automatiquement en dark via la classe `.dark` posée sur
// <html> par @nuxtjs/color-mode (intégré par Nuxt UI).
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <header class="sticky top-0 z-10 border-b border-default bg-elevated">
      <div class="mx-auto flex min-h-14 max-w-2xl items-center justify-between gap-2 px-4 py-3">
        <NuxtLink to="/" class="text-lg font-semibold text-primary-900">
          Pétankup
        </NuxtLink>
        <ClientOnly>
          <UColorModeButton variant="ghost" color="neutral" />
          <template #fallback>
            <div class="size-8" />
          </template>
        </ClientOnly>
      </div>
    </header>

    <main class="mx-auto max-w-2xl p-4">
      <slot />
    </main>
  </div>
</template>
