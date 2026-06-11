<script setup lang="ts">
// Bandeau navy en haut de presque tous les écrans (Direction C) : dégradé du
// socle, bouton retour, kicker doré, gros titre cream multi-ligne, sous-titre,
// et au besoin une rangée d'onglets ou un bouton de fermeture (sheets).
// Purement présentationnel : la navigation et l'onglet actif appartiennent au
// parent. Onglets rendus en boutons custom — UTabs ne couvre pas la pilule
// cream/navy sur dégradé sans empiler des surcharges (audit acté en plan).

type EnteteOnglet = {
  id: string
  label: string
}

const props = withDefaults(
  defineProps<{
    title: string
    kicker?: string
    subtitle?: string
    back?: { label: string; to: string }
    closable?: boolean
    tabs?: EnteteOnglet[]
    activeTab?: string
  }>(),
  {
    kicker: undefined,
    subtitle: undefined,
    back: undefined,
    closable: false,
    tabs: undefined,
    activeTab: undefined,
  },
)

const emit = defineEmits<{
  close: []
  'tab-change': [tabId: string]
}>()

const hasTabs = computed(() => (props.tabs?.length ?? 0) > 0)
</script>

<template>
  <header
    class="relative overflow-hidden rounded-b-(--pk-r-header) [background:var(--pk-grad-header)]"
    :class="hasTabs ? 'pb-4' : 'pb-[22px]'"
  >
    <div
      class="pointer-events-none absolute -top-[34px] -right-[38px] opacity-50"
    >
      <BouleAvatar tone="dark" :size="150" :striped="false" />
    </div>

    <div class="relative px-5 pt-1">
      <div
        v-if="back || closable"
        class="flex items-center justify-between"
      >
        <NuxtLink
          v-if="back"
          :to="back.to"
          class="inline-flex items-center gap-[7px] font-sans text-sm font-bold text-(--pk-on-navy-2)"
        >
          <UIcon name="i-lucide-arrow-left" class="size-[18px]" />
          {{ back.label }}
        </NuxtLink>
        <button
          v-if="closable"
          type="button"
          aria-label="Fermer"
          class="ml-auto inline-flex size-[34px] items-center justify-center rounded-(--pk-r-sm) bg-(--pk-on-navy-10) text-(--pk-on-navy)"
          @click="emit('close')"
        >
          <UIcon name="i-lucide-x" class="size-[18px]" />
        </button>
      </div>

      <p
        v-if="kicker"
        class="font-disp text-[11px] font-extrabold tracking-[0.14em] uppercase text-secondary"
      >
        {{ kicker }}
      </p>

      <h1
        class="mt-2 mb-1 font-disp text-[26px] font-extrabold leading-[1.05] tracking-[-0.02em] whitespace-pre-line text-(--pk-cream)"
      >
        {{ title }}
      </h1>

      <p
        v-if="subtitle"
        class="font-sans text-[12.5px] text-(--pk-on-navy-2)"
      >
        {{ subtitle }}
      </p>

      <nav v-if="hasTabs" class="mt-4 flex gap-[7px]">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="rounded-(--pk-r-sm) px-3.5 py-[9px] font-disp text-xs font-extrabold tracking-[0.04em]"
          :class="
            tab.id === activeTab
              ? 'bg-(--pk-cream) text-(--pk-navy)'
              : 'bg-(--pk-on-navy-08) text-(--pk-on-navy-2)'
          "
          @click="emit('tab-change', tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>
  </header>
</template>
