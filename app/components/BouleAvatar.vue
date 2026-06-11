<script lang="ts">
// Type public du composant : les consommateurs (ScoreboardEquipe,
// CarteTournoi…) typent leur prop `tone` dessus via
// `import type { BouleTone } from './BouleAvatar.vue'`.
export type BouleTone =
  | 'horizon'
  | 'sand'
  | 'gold'
  | 'silver'
  | 'bronze'
  | 'clay'
  | 'dark'
</script>

<script setup lang="ts">
// Boule de pétanque — motif signature de l'app (avatars d'équipe, compte,
// podium, décor). Brique PUREMENT visuelle : elle reçoit un `tone`, elle ne le
// calcule pas (la couleur ne dérive jamais d'un rang ici). Rendu en CSS pur :
// UAvatar ne sait pas produire la sphère (dégradé radial + reflet + striures +
// ombre galbée), qui est le cœur identitaire.
//
// Recette de rendu prescriptive (source Claude Design) — ne pas réinventer le
// dégradé ni les offsets. Tout est proportionnel à `size` pour rester net à
// n'importe quelle échelle.

const props = withDefaults(
  defineProps<{
    tone?: BouleTone
    size?: number
    striped?: boolean
    ariaLabel?: string
  }>(),
  {
    tone: 'horizon',
    size: 60,
    striped: true,
    ariaLabel: undefined,
  },
)

// Palette propre de la boule (rendu matière), distincte des tokens sémantiques
// du socle : une boule est une texture, pas une couleur d'action. Chaque entrée
// est la liste de color-stops injectée dans `radial-gradient(circle at 34% 28%, …)`.
const TONE_GRADIENTS: Record<BouleTone, string> = {
  horizon: '#D6E8ED 0%, #7FA9B5 32%, #3D6E7C 64%, #15303A 100%',
  sand: '#F7F1DE 0%, #DBC987 32%, #B49E55 64%, #6E6430 100%',
  gold: '#FBEFC0 0%, #E6C45C 30%, #C29A2E 64%, #806012 100%',
  silver: '#FBFAF6 0%, #D2CEC4 34%, #A6A199 66%, #66625A 100%',
  bronze: '#F0D4B8 0%, #C78A5C 34%, #9A5E34 66%, #5C3A22 100%',
  clay: '#E8B79A 0%, #C8632F 36%, #9C4A22 66%, #5E2D14 100%',
  dark: '#45616B 0%, #2B5060 36%, #1A3540 66%, #0C1E25 100%',
}

// Trois striures verticales fines (pas un linear-gradient : plus net). Le
// conteneur les clippe au cercle via `overflow: hidden`.
const STRIAE = [
  { left: '38%', background: 'rgba(255, 255, 255, 0.18)' },
  { left: '50%', background: 'rgba(0, 0, 0, 0.14)' },
  { left: '62%', background: 'rgba(255, 255, 255, 0.12)' },
]

const sphereStyle = computed(() => {
  const size = props.size
  return {
    width: `${size}px`,
    height: `${size}px`,
    background: `radial-gradient(circle at 34% 28%, ${TONE_GRADIENTS[props.tone]})`,
    // Ombre interne bas-droite (terminator de la sphère) + ombre portée dessous.
    boxShadow:
      `inset ${-size * 0.05}px ${-size * 0.09}px ${size * 0.16}px rgba(0, 0, 0, 0.28), ` +
      `0 ${size * 0.05}px ${size * 0.12}px rgba(20, 30, 35, 0.22)`,
  }
})

const initialStyle = computed(() => ({
  fontSize: `${props.size * 0.42}px`,
}))
</script>

<template>
  <div
    class="relative isolate flex shrink-0 items-center justify-center overflow-hidden rounded-full"
    :style="sphereStyle"
    :role="ariaLabel ? 'img' : undefined"
    :aria-label="ariaLabel"
    :aria-hidden="ariaLabel ? undefined : true"
  >
    <template v-if="striped">
      <span
        v-for="stria in STRIAE"
        :key="stria.left"
        class="absolute top-[12%] bottom-[12%] w-px"
        :style="{ left: stria.left, background: stria.background }"
      />
    </template>

    <span
      class="absolute top-[16%] left-[22%] h-[20%] w-[26%] rounded-full"
      style="background: rgba(255, 255, 255, 0.45); filter: blur(3px)"
    />

    <span
      class="relative z-10 font-disp leading-none font-bold"
      :style="initialStyle"
    >
      <slot />
    </span>
  </div>
</template>
