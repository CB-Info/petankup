<script setup lang="ts">
import type { TournamentVisibility } from '../types'

const props = defineProps<{
  visibility: TournamentVisibility
}>()

type BadgeColor = 'primary' | 'secondary'

const color = computed<BadgeColor>(() =>
  props.visibility === 'public' ? 'primary' : 'secondary',
)

const icon = computed(() =>
  props.visibility === 'public' ? 'i-lucide-globe' : 'i-lucide-lock',
)

const label = computed(() =>
  props.visibility === 'public' ? 'Public' : 'Privé',
)
</script>

<template>
  <UBadge :color="color" :icon="icon" variant="soft">
    {{ label }}
  </UBadge>
</template>
