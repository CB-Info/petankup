<script setup lang="ts">
// En-tête de colonnes du classement. Statique : les largeurs (V/D 28px,
// DIFF 40px), le gap (11px) et le padding horizontal (16px) DOIVENT rester
// alignés sur ceux de LigneClassement — une seule source de vérité pour la
// grille, partagée entre l'en-tête et les lignes.
</script>

<template>
  <div
    class="flex gap-2.75 px-4 font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
  >
    <span class="flex-1">Classement</span>
    <span class="w-7 text-center">V</span>
    <span class="w-7 text-center">D</span>
    <span class="w-10 text-right">Diff</span>
  </div>
</template>
