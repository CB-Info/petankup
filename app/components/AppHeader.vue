<script lang="ts">
// Types publics du composant, importables par les écrans via
// `import type { HeaderTournoi } from './AppHeader.vue'`.
export interface HeaderTournoi {
  /** Titre du tournoi, multi-ligne via \n (rendu whitespace-pre-line). */
  titre: string
  /** Affiché « {matchsJoues}/{matchsTotal} » sous le label MATCHS. */
  matchsJoues: number
  matchsTotal: number
  equipes: number
  /** Label du CTA, ex. « Reprendre le tournoi ». */
  ctaLabel: string
}
</script>

<script setup lang="ts">
// Bandeau navy en haut de presque tous les écrans (Direction C), en deux
// variantes : `interne` (retour, kicker, titre, sous-titre, onglets, close) et
// `accueil` (logo ● Pétankup + pastille profil, bloc tournoi-en-cours piloté
// par la prop `tournoi` — le composant possède le markup du bloc, l'écran ne
// fournit que des données). Purement présentationnel : navigation, onglet
// actif, initiale du profil appartiennent au parent ; le CTA émet `reprendre`
// sans câbler de navigation.
//
// Conçu extensible vers les presets podium/sheet/modale du plan directeur
// (props `kickerTone`, `titleSize`, `padBottom`), mais SEULES les deux
// variantes navy sont implémentées ici — les autres seront ajoutées au moment
// de leurs écrans. Onglets custom : UTabs ne couvre pas la pilule cream/navy
// sur dégradé sans empiler des surcharges (audit acté).
//
// La status bar n'est jamais simulée : c'est l'OS qui la rend, le conteneur
// réserve l'espace via `env(safe-area-inset-top)`.

type HeaderMode = 'interne' | 'accueil'

// `clay` et `subtle` sont pressentis pour les variantes sheet/modale, à
// valider à leurs écrans ; seul `gold` est utilisé aujourd'hui.
type KickerTone = 'gold' | 'clay' | 'subtle'

type HeaderOnglet = {
  id: string
  label: string
}

const props = withDefaults(
  defineProps<{
    mode?: HeaderMode
    /** Requis en mode interne ; en mode accueil le titre vit dans `tournoi`. */
    title?: string
    kicker?: string
    kickerTone?: KickerTone
    subtitle?: string
    back?: { label: string; to: string }
    closable?: boolean
    tabs?: HeaderOnglet[]
    activeTab?: string
    /** 26 = écran interne, 30 = accueil. (40 podium : différé.) */
    titleSize?: 26 | 30
    /** Surcharge du padding bas ; défaut calculé selon le contenu. */
    padBottom?: number
    /** Initiale de la pastille profil (mode accueil). */
    profileInitial?: string
    /** Bloc tournoi-en-cours (mode accueil). Absent = état vide. */
    tournoi?: HeaderTournoi
  }>(),
  {
    mode: 'interne',
    title: undefined,
    kicker: undefined,
    kickerTone: 'gold',
    subtitle: undefined,
    back: undefined,
    closable: false,
    tabs: undefined,
    activeTab: undefined,
    titleSize: 26,
    padBottom: undefined,
    profileInitial: undefined,
    tournoi: undefined,
  },
)

const emit = defineEmits<{
  close: []
  'tab-change': [tabId: string]
  profile: []
  reprendre: []
}>()

const isAccueil = computed(() => props.mode === 'accueil')
const hasTabs = computed(() => (props.tabs?.length ?? 0) > 0)
const hasTournoi = computed(
  () => isAccueil.value && props.tournoi !== undefined,
)

// Interne : la rangée du haut n'existe que si retour ou close.
// Accueil : toujours présente (logo + pastille profil).
const topRowVisible = computed(
  () => isAccueil.value || !!props.back || props.closable,
)

// 16 avec onglets ; accueil : 26 avec bloc tournoi, 18 vide ; sinon 22.
const effectivePadBottom = computed(() => {
  if (props.padBottom !== undefined) return props.padBottom
  if (hasTabs.value) return 16
  if (isAccueil.value) return hasTournoi.value ? 26 : 18
  return 22
})

const KICKER_TONE_CLASS: Record<KickerTone, string> = {
  gold: 'text-secondary',
  clay: 'text-primary',
  subtle: 'text-(--pk-on-navy-2)',
}

const kickerClass = computed(() => KICKER_TONE_CLASS[props.kickerTone])

const titleSizeClass = computed(() =>
  props.titleSize === 30 ? 'text-[30px]' : 'text-[26px]',
)
</script>

<template>
  <header
    class="relative overflow-hidden rounded-b-(--pk-r-header) pt-[env(safe-area-inset-top)] [background:var(--pk-grad-header)]"
    :style="{ paddingBottom: `${effectivePadBottom}px` }"
  >
    <div
      class="pointer-events-none absolute -top-[34px] -right-[38px] opacity-50"
    >
      <BouleAvatar tone="dark" :size="150" :striped="false" />
    </div>

    <div class="relative px-5 pt-1">
      <!-- Rangée du haut : retour/close (interne) ou logo/profil (accueil) -->
      <div v-if="topRowVisible" class="flex items-center justify-between">
        <template v-if="isAccueil">
          <div class="flex items-center gap-[9px]">
            <BouleAvatar tone="gold" :size="26" />
            <span
              class="font-disp text-[19px] font-extrabold tracking-[-0.01em] uppercase text-(--pk-cream)"
            >
              Pétankup
            </span>
          </div>
          <button
            type="button"
            aria-label="Mon compte"
            class="inline-flex size-[38px] items-center justify-center rounded-(--pk-r-md) bg-(--pk-on-navy-10) font-disp text-sm font-extrabold text-(--pk-on-navy)"
            @click="emit('profile')"
          >
            {{ profileInitial }}
          </button>
        </template>

        <template v-else>
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
        </template>
      </div>

      <!-- Bloc titre : mode interne uniquement (en accueil, le titre vit dans
           la prop `tournoi`) -->
      <div
        v-if="!isAccueil"
        :class="topRowVisible ? 'mt-3' : 'mt-2'"
      >
        <p
          v-if="kicker"
          class="font-disp text-[11px] font-extrabold tracking-[0.14em] uppercase"
          :class="kickerClass"
        >
          {{ kicker }}
        </p>

        <h1
          class="mb-1 font-disp font-extrabold leading-[1.05] tracking-[-0.02em] whitespace-pre-line text-(--pk-cream)"
          :class="[titleSizeClass, kicker ? 'mt-2' : '']"
        >
          {{ title }}
        </h1>

        <p
          v-if="subtitle"
          class="font-sans text-[12.5px] text-(--pk-on-navy-2)"
        >
          {{ subtitle }}
        </p>
      </div>

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

      <!-- Bloc tournoi-en-cours (mode accueil) : le composant possède le
           markup, l'écran ne passe que les données via la prop `tournoi` -->
      <div v-if="hasTournoi && tournoi" class="mt-5">
        <StatutBadge statut="in_progress" live variant="header" />

        <h1
          class="mt-2.5 font-disp text-[30px] font-extrabold leading-[1.05] tracking-[-0.02em] whitespace-pre-line text-(--pk-cream)"
        >
          {{ tournoi.titre }}
        </h1>

        <div class="mt-[18px] flex gap-[22px]">
          <div>
            <p class="font-num text-2xl font-bold leading-[1.1] text-(--pk-cream)">
              {{ tournoi.matchsJoues }}/{{ tournoi.matchsTotal }}
            </p>
            <p
              class="mt-[3px] font-disp text-[9.5px] font-bold tracking-[0.12em] uppercase text-(--pk-on-navy-3)"
            >
              Matchs
            </p>
          </div>
          <div>
            <p class="font-num text-2xl font-bold leading-[1.1] text-(--pk-cream)">
              {{ tournoi.equipes }}
            </p>
            <p
              class="mt-[3px] font-disp text-[9.5px] font-bold tracking-[0.12em] uppercase text-(--pk-on-navy-3)"
            >
              Équipes
            </p>
          </div>
        </div>

        <button
          type="button"
          class="mt-5 flex h-[50px] w-full items-center justify-center gap-2 rounded-[13px] bg-primary font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
          @click="emit('reprendre')"
        >
          {{ tournoi.ctaLabel }}
          <UIcon name="i-lucide-arrow-right" class="size-[18px]" />
        </button>
      </div>
    </div>
  </header>
</template>
