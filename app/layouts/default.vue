<script setup lang="ts">
// Layout shell : header unique + zone de contenu centrée mobile-first.
// Couleurs neutres servies par les utilitaires sémantiques Nuxt UI
// (thème « Nuit & Corail », mode clair uniquement — pas de bascule dark).
//
// Une seule source de header : AppHeader est monté ICI, une fois, piloté par
// l'état de `useAppHeader`. Chaque page déclare sa config dans son setup.
// La déconnexion ne vit plus dans le layout : elle est accessible via /account
// (page profil → « Modifier mes infos »), donc aucun bouton logout ici.

import type { AppHeaderState } from "~/composables/useAppHeader";

const { state: header } = useAppHeader();

// On retire les callbacks (on*) et `actions` avant de v-bind : les on*
// deviendraient des listeners en double avec les @… ci-dessous, et `actions`
// passe par le slot, pas par une prop d'AppHeader.
//
// `header.value` est DeepReadonly (readonly() côté composable) alors qu'AppHeader
// attend des props mutables (ses tableaux, ex. `tabs`). On ne fait que lire ici,
// donc l'assertion locale vers AppHeaderState est sûre.
const headerProps = computed(() => {
  if (!header.value) return null;
  const { onProfile, onClose, onTabChange, onReprendre, actions, ...props } =
    header.value as AppHeaderState;
  return props;
});

const headerActions = computed(() => header.value?.actions ?? []);

// Relais des emits vers les callbacks de l'état (fonctions nommées plutôt
// qu'expressions inline : lisibilité + narrowing TS propre).
function handleProfile() {
  const onProfile = header.value?.onProfile;
  // Défaut raisonnable si la page n'en fournit pas : aller au compte.
  if (onProfile) onProfile();
  else void navigateTo("/account");
}
function handleClose() {
  header.value?.onClose?.();
}
function handleTabChange(tabId: string) {
  header.value?.onTabChange?.(tabId);
}
function handleReprendre() {
  header.value?.onReprendre?.();
}
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <div class="mx-auto max-w-2xl">
      <AppHeader
        v-if="headerProps"
        v-bind="headerProps"
        @profile="handleProfile"
        @close="handleClose"
        @tab-change="handleTabChange"
        @reprendre="handleReprendre"
      >
        <template v-if="headerActions.length" #actions>
          <button
            v-for="action in headerActions"
            :key="action.id"
            type="button"
            :aria-label="action.ariaLabel"
            class="inline-flex size-8.5 items-center justify-center rounded-(--pk-r-sm) bg-(--pk-on-navy-10) text-(--pk-on-navy)"
            @click="action.onClick"
          >
            <UIcon :name="action.icon" class="size-4.5" />
          </button>
        </template>
      </AppHeader>

      <main class="px-4.5 pt-5.5 pb-10">
        <slot />
      </main>
    </div>
  </div>
</template>
